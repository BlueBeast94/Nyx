// Importa perfumes desde la planilla de Google Sheets a la tabla "perfumes" de Supabase,
// generando una descripción única con Groq para cada perfume nuevo.
//
// Uso:
//   node scripts/import-perfumes.js           -> preview: no escribe nada en la base. Genera
//                                                import-output/preview.csv (para revisar en Excel/Sheets)
//                                                y import-output/preview.json (lo que se va a cargar).
//   node scripts/import-perfumes.js --apply   -> carga en la base los perfumes "nuevo" del último preview.
//                                                Con --stock=N se cargan con ese stock (por defecto 0).
//
// Las descripciones ya generadas quedan guardadas en preview.json, así que volver a correr el
// preview solo le pide a Groq las que faltan (útil si Groq corta por límite de uso).

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = require("ws");
}

const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/1p3ZrX3z0cG-0Xzg7R80_A0xyXPstJbTBhpFpsWWBBe4/export?format=csv";
// Sin claves de Supabase en .env, el preview lee los perfumes existentes desde la API pública del sitio.
const PUBLIC_PERFUMES_URL = "https://nyx-fragancias.vercel.app/api/perfumes";

const OUTPUT_DIR = path.join(__dirname, "..", "import-output");
const PREVIEW_JSON = path.join(OUTPUT_DIR, "preview.json");
const PREVIEW_CSV = path.join(OUTPUT_DIR, "preview.csv");

const GROQ_MODEL = "openai/gpt-oss-120b";
// Varios perfumes por llamada: rinde mucho más el límite de tokens de Groq que uno por uno.
const DESCRIPTION_BATCH_SIZE = 8;

// Marcas que en la planilla se escriben distinto que en la base. Se usa el nombre de la base.
const BRAND_ALIASES = {
    dkny: "Donna Karan"
};

// Perfumes de la planilla que ya están cargados en la base con otro nombre.
// Marca (como en la planilla) -> { "Modelo en la planilla": "Modelo en la base" }
const ALREADY_LOADED = {
    Kenzo: {
        "Kenzo Pour Homme": "Kenzo",
        "Kenzo Homme Night": "Homme Night",
        "Kenzo Homme Intense": "Intense",
        "L'Eau Kenzo Boisée": "L'Eau par Kenzo Boisée",
        "L'Eau par Kenzo Pour Homme": "L'Eau par Kenzo"
    },
    "Jean Paul Gaultier": {
        "Scandal Pour Homme": "Scandal",
        "Scandal Pour Homme Absolu": "Scandal Absolu",
        "Scandal Pour Homme Intense": "Scandal Intense",
        "Scandal Pour Homme Le Parfum": "Scandal Parfum",
        "Le Beau Paradise Garden": "Le Beau Paradise"
    },
    "Issey Miyake": {
        "Nuit d'Issey Bleu Astral": "Nuit d'Issey Blue Astral",
        "Fusion d'Issey": "Fussion  D'lssey  L'Blue",
        "L'Eau d'Issey Pour Homme": "L'Eau d'Issey"
    },
    "Hugo Boss": {
        "Hugo Red": "Red",
        "Hugo Just Different": "Just Different",
        "Hugo Dark Blue": "Dark Blue",
        "Boss Bottled Night": "Night Bottled",
        "Boss The Scent Elixir": "The Scent Elixir",
        "Boss Bottled Absolu": "Bottled Absolute",
        "Boss Bottled Infinite": "Bottled Infinite",
        "Boss Bottled Intense": "Intense"
    },
    Hermès: { "Terre d'Hermès": "Terre" },
    Gucci: { "Guilty Pour Homme": "Guilty" },
    Giesso: { "N°1": "Nro 1" },
    Givenchy: {
        "Givenchy Pour Homme": "Pour Homme",
        "Gentleman Only Absolute": "Gentleman Only Absolut",
        "Very Irrésistible for Men": "Very Irresistible"
    },
    "Giorgio Armani": {
        "Emporio Armani Night": "Emporio Night",
        "Armani Code Absolu": "Code Absolu"
    },
    Ferrari: { Red: "Ferrari Red", Black: "Ferrari Black" },
    Fendi: { "Fan di Fendi Pour Homme": "Fan di Fendi" },
    "Dolce & Gabbana": {
        "K by Dolce & Gabbana": "King",
        "The One for Men": "The One",
        "Light Blue Pour Homme": "Light Blue",
        "Devotion Pour Homme": "Devotion"
    },
    Dior: {
        "Dior Homme": "Homme",
        "Dior Homme Intense": "Homme Intense",
        "Dior Homme Sport": "Homme Sport",
        "J'adore": "J'dore"
    },
    Chanel: { "Bleu de Chanel": "Bleu", "Allure Homme Sport": "Allure Sport" },
    "Carolina Herrera": {
        "CH Men Privé": "Prive",
        "CH Africa": "Africa",
        "CH Men": "Clasico",
        "Bad Boy Cobalt Électrique": "Bad Boy Cobal Electrique",
        "212 VIP Wild Party": "212 VIP Wild",
        "212 Men On Ice": "212 On Ice",
        "212 NYC Men": "212 New York",
        "212 VIP Men": "212 VIP",
        "212 Sexy Men": "212 Sexy",
        "212 Glam Men": "212 Glam"
    },
    "Calvin Klein": { "CK One Shock for Him": "Shock" },
    Bvlgari: {
        "Aqva Pour Homme Marine": "Aqva Pour Home Marine",
        "Man Wood Essence": "Wood Essence",
        "BLV Notte": "Notte"
    },
    Armaf: {
        "Odyssey Homme White": "Odyssey Home White",
        "Odyssey Mandarin Sky Elixir": "Odyssey Mandarine Sky Elixir",
        "Odyssey Mandarin Sky": "Odissey Mandarine Sky",
        "Club de Nuit Intense Man": "Club de Nuit"
    },
    "Antonio Banderas": { "The Icon": "Icon" },
    "Tom Ford": { "Oud Wood": "Out Wood" },
    Bharara: { King: "King Bharara" },
    Lancôme: { "Hypnôse Homme": "Hypnose" },
    Lacoste: { "L.12.12 Blue Powerful": "Blue Powerful" },
    DKNY: { "Be Delicious Men": "Be Delicious" }
};

// Compara sin mayúsculas, acentos, espacios ni signos: "Le Mâle" == "le male".
const norm = (s) =>
    (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]/g, "");

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else field += c;
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

async function loadSheet() {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`No se pudo descargar la planilla (${res.status}). ¿Sigue compartida con link?`);
    const [header, ...rows] = parseCsv(await res.text());
    const col = (name) => header.findIndex((h) => norm(h) === norm(name));
    const idx = {
        gender: col("Clasificación"),
        brand: col("Marca"),
        model: col("Modelo"),
        top: col("Notas de salida"),
        middle: col("Notas de corazón"),
        base: col("Notas de fondo"),
        confidence: col("Confianza de las notas"),
        observations: col("Observaciones"),
        description: col("Descripcion Comercial")
    };
    const missing = Object.entries(idx).filter(([, i]) => i === -1);
    if (missing.length) throw new Error(`Faltan columnas en la planilla: ${missing.map(([k]) => k).join(", ")}`);

    return rows
        .map((r, i) => ({
            sheetRow: i + 2,
            gender: (r[idx.gender] || "").trim().toLowerCase(),
            brand: (r[idx.brand] || "").trim(),
            model: (r[idx.model] || "").trim(),
            notesTop: (r[idx.top] || "").trim(),
            notesMiddle: (r[idx.middle] || "").trim(),
            notesBase: (r[idx.base] || "").trim(),
            confidence: (r[idx.confidence] || "").trim(),
            observations: (r[idx.observations] || "").trim(),
            sheetDescription: (r[idx.description] || "").trim()
        }))
        .filter((r) => r.brand && r.model);
}

function getSupabaseAdmin() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

async function loadExistingPerfumes(supabaseAdmin) {
    if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin.from("perfumes").select("brand, model, gender, description");
        if (error) throw new Error(`No se pudieron leer los perfumes de la base: ${error.message}`);
        return data;
    }
    console.warn("Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env: leyendo perfumes desde la API pública del sitio.");
    const res = await fetch(PUBLIC_PERFUMES_URL);
    if (!res.ok) throw new Error(`No se pudo leer ${PUBLIC_PERFUMES_URL} (${res.status})`);
    return res.json();
}

// Unisex en la planilla, o género vacío en la base, coinciden con cualquier género.
const sameGender = (sheetGender, dbGender) => !dbGender || sheetGender === "unisex" || sheetGender === dbGender;

function classify(sheetRows, existing) {
    const brandSpelling = new Map(existing.map((p) => [norm(p.brand), p.brand]));
    const aliases = new Map();
    for (const [brand, models] of Object.entries(ALREADY_LOADED)) {
        for (const [sheetModel, dbModel] of Object.entries(models)) {
            aliases.set(`${norm(brand)}|${norm(sheetModel)}`, dbModel);
        }
    }

    return sheetRows.map((row) => {
        const brand = BRAND_ALIASES[norm(row.brand)] || brandSpelling.get(norm(row.brand)) || row.brand;
        const sameBrand = existing.filter((p) => norm(p.brand) === norm(brand));
        const entry = { ...row, brand, sheetBrand: row.brand, review: [] };

        const exact = sameBrand.find((p) => norm(p.model) === norm(row.model) && sameGender(row.gender, p.gender));
        if (exact) return { ...entry, status: "ya existe", matchedModel: exact.model };

        const aliasModel = aliases.get(`${norm(row.brand)}|${norm(row.model)}`);
        const aliased = aliasModel && sameBrand.find((p) => norm(p.model) === norm(aliasModel));
        if (aliased) return { ...entry, status: "ya existe", matchedModel: aliased.model };

        if (!row.notesTop && !row.notesMiddle && !row.notesBase) {
            return { ...entry, status: "sin notas", review: ["La planilla no tiene notas: cargar a mano"] };
        }
        if (!["masculino", "femenino", "unisex"].includes(row.gender)) {
            return { ...entry, status: "revisar", review: [`Clasificación desconocida: "${row.gender}"`] };
        }

        const similar = sameBrand.filter(
            (p) => norm(p.model).includes(norm(row.model)) || norm(row.model).includes(norm(p.model))
        );
        if (similar.length) {
            entry.review.push(`Parecido a lo cargado: ${similar.map((p) => `${p.model} (${p.gender || "sin género"})`).join(", ")}`);
        }
        if (/verificar/i.test(row.confidence)) entry.review.push("Notas a verificar");
        if (row.observations) entry.review.push(row.observations);
        return { ...entry, status: "nuevo" };
    });
}

async function callGroq(messages) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages,
                temperature: 0.8,
                max_tokens: 4000,
                reasoning_effort: "low",
                response_format: { type: "json_object" }
            })
        });

        if (res.status === 429 && attempt <= 8) {
            const wait = Math.ceil(Number(res.headers.get("retry-after")) || 30);
            console.log(`  Groq pidió esperar (límite de uso): reintento en ${wait}s...`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            continue;
        }
        if (!res.ok) throw new Error(`Groq API error (${res.status}): ${await res.text()}`);

        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
    }
}

function buildDescriptionPrompt(batch, examples) {
    const genderLabel = { masculino: "masculino", femenino: "femenino", unisex: "unisex" };
    const perfumes = batch.map((p, i) => ({
        id: i,
        perfume: `${p.brand} ${p.model}`,
        genero: genderLabel[p.gender],
        notas_salida: p.notesTop,
        notas_corazon: p.notesMiddle,
        notas_fondo: p.notesBase,
        perfil_orientativo: p.sheetDescription
    }));

    return [
        {
            role: "system",
            content:
                "Sos redactor de NYX, una perfumería argentina. Escribís descripciones comerciales de perfumes en español, " +
                "cálidas y elegantes, para la ficha de cada producto en la tienda online.\n\n" +
                "Reglas:\n" +
                "- 2 o 3 oraciones, entre 45 y 70 palabras.\n" +
                "- Basate en las notas reales del perfume: nombrá 2 a 4 de ellas y qué sensación dan.\n" +
                "- Cerrá con cuándo usarlo (momento del día, estación u ocasión).\n" +
                "- Cada descripción tiene que ser distinta: variá el arranque, no empieces todas con \"Una fragancia\".\n" +
                "- No inventes datos (año, perfumista, concentración) ni uses el nombre de la marca o el perfume en el texto.\n" +
                "- Sin emojis, sin comillas, sin signos de exclamación.\n\n" +
                "Ejemplos del estilo de la tienda:\n" +
                examples.map((e) => `- ${e}`).join("\n") +
                '\n\nRespondé solo con JSON: {"descripciones": [{"id": 0, "texto": "..."}, ...]}, una por perfume.'
        },
        { role: "user", content: JSON.stringify(perfumes) }
    ];
}

async function generateDescriptions(entries, existing) {
    const pending = entries.filter((e) => e.status === "nuevo" && !e.description);
    if (pending.length === 0) return;

    if (!process.env.GROQ_API_KEY) {
        console.warn(`Sin GROQ_API_KEY en .env: ${pending.length} perfumes nuevos quedan sin descripción.`);
        return;
    }

    const examples = existing
        .map((p) => p.description)
        .filter((d) => d && d.length > 120)
        .slice(0, 4);

    console.log(`Generando descripciones con Groq para ${pending.length} perfumes...`);
    for (let i = 0; i < pending.length; i += DESCRIPTION_BATCH_SIZE) {
        const batch = pending.slice(i, i + DESCRIPTION_BATCH_SIZE);
        try {
            const raw = await callGroq(buildDescriptionPrompt(batch, examples));
            const parsed = JSON.parse(raw).descripciones || [];
            for (const { id, texto } of parsed) {
                if (batch[id] && texto) batch[id].description = texto.trim();
            }
        } catch (err) {
            console.error(`  Error en el lote ${i / DESCRIPTION_BATCH_SIZE + 1}: ${err.message}`);
        }
        const done = pending.filter((e) => e.description).length;
        console.log(`  ${done}/${pending.length}`);
        savePreview(entries); // guarda el avance para poder retomar si se corta
    }
}

function savePreview(entries) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(PREVIEW_JSON, JSON.stringify(entries, null, 2));

    const columns = [
        ["Estado", (e) => e.status],
        ["Fila planilla", (e) => e.sheetRow],
        ["Clasificación", (e) => e.gender],
        ["Marca", (e) => e.brand],
        ["Modelo", (e) => e.model],
        ["Ya cargado como", (e) => e.matchedModel || ""],
        ["Notas de salida", (e) => e.notesTop],
        ["Notas de corazón", (e) => e.notesMiddle],
        ["Notas de fondo", (e) => e.notesBase],
        ["Descripción nueva (Groq)", (e) => e.description || ""],
        ["Revisar", (e) => e.review.join(" | ")]
    ];
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // Separado por ";" con BOM para que Excel en español lo abra con columnas y acentos bien.
    const csv = [columns.map(([h]) => cell(h)).join(";"), ...entries.map((e) => columns.map(([, f]) => cell(f(e))).join(";"))].join(
        "\r\n"
    );
    fs.writeFileSync(PREVIEW_CSV, "﻿" + csv);
}

function printSummary(entries) {
    const count = (status) => entries.filter((e) => e.status === status).length;
    const nuevos = entries.filter((e) => e.status === "nuevo");
    const byGender = (g) => nuevos.filter((e) => e.gender === g).length;

    console.log("\n===== PREVIEW (no se escribió nada en la base) =====");
    console.log(`Filas en la planilla:     ${entries.length}`);
    console.log(`Ya existen en la base:    ${count("ya existe")}`);
    console.log(
        `Nuevos a cargar:          ${nuevos.length}  (femenino ${byGender("femenino")}, masculino ${byGender("masculino")}, unisex ${byGender("unisex")})`
    );
    console.log(`  con descripción lista:  ${nuevos.filter((e) => e.description).length}`);
    console.log(`  marcados para revisar:  ${nuevos.filter((e) => e.review.length).length}`);
    console.log(`Sin notas (se saltan):    ${count("sin notas")}`);
    console.log(`Con errores (se saltan):  ${count("revisar")}`);
    console.log(`\nDetalle completo: ${PREVIEW_CSV}`);
}

async function preview() {
    const supabaseAdmin = getSupabaseAdmin();
    const [sheetRows, existing] = await Promise.all([loadSheet(), loadExistingPerfumes(supabaseAdmin)]);
    const entries = classify(sheetRows, existing);

    // Reusa descripciones de un preview anterior para no volver a pedírselas a Groq.
    if (fs.existsSync(PREVIEW_JSON)) {
        const previous = new Map(
            JSON.parse(fs.readFileSync(PREVIEW_JSON, "utf8")).map((e) => [`${norm(e.brand)}|${norm(e.model)}|${e.gender}`, e])
        );
        for (const e of entries) {
            const prev = previous.get(`${norm(e.brand)}|${norm(e.model)}|${e.gender}`);
            if (e.status === "nuevo" && prev?.description) e.description = prev.description;
        }
    }

    await generateDescriptions(entries, existing);
    savePreview(entries);
    printSummary(entries);
}

async function apply() {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) throw new Error("Para --apply hacen falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
    if (!fs.existsSync(PREVIEW_JSON)) throw new Error("No hay preview. Corré primero: node scripts/import-perfumes.js");

    const entries = JSON.parse(fs.readFileSync(PREVIEW_JSON, "utf8"));
    const nuevos = entries.filter((e) => e.status === "nuevo");
    const withoutDescription = nuevos.filter((e) => !e.description);
    if (withoutDescription.length) {
        throw new Error(`${withoutDescription.length} perfumes nuevos no tienen descripción. Corré el preview de nuevo para completarlas.`);
    }

    // Vuelve a chequear contra la base por si algo se cargó a mano después del preview.
    const existing = await loadExistingPerfumes(supabaseAdmin);
    const toInsert = nuevos.filter(
        (e) => !existing.some((p) => norm(p.brand) === norm(e.brand) && norm(p.model) === norm(e.model) && sameGender(e.gender, p.gender))
    );

    const stockArg = process.argv.find((a) => a.startsWith("--stock="));
    const initialStock = stockArg ? Math.max(0, parseInt(stockArg.split("=")[1], 10) || 0) : 0;

    const rows = toInsert.map((e) => ({
        name: e.model,
        brand: e.brand,
        model: e.model,
        gender: e.gender,
        stock_quantity: initialStock,
        image_url: null,
        notes_top: e.notesTop,
        notes_middle: e.notesMiddle,
        notes_base: e.notesBase,
        description: e.description,
        price: null,
        discount_percent: null
    }));

    for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabaseAdmin.from("perfumes").insert(rows.slice(i, i + 50));
        if (error) throw new Error(`Error insertando perfumes (desde el ${i + 1}): ${error.message}`);
        console.log(`  ${Math.min(i + 50, rows.length)}/${rows.length} perfumes cargados`);
    }

    // Agrega las marcas nuevas a la tabla de marcas, igual que el alta manual del dashboard.
    const { data: brands } = await supabaseAdmin.from("brands").select("name");
    const knownBrands = new Set((brands || []).map((b) => b.name.toLowerCase()));
    const newBrands = [...new Set(rows.map((r) => r.brand))].filter((b) => !knownBrands.has(b.toLowerCase()));
    if (newBrands.length) {
        const { error } = await supabaseAdmin.from("brands").insert(newBrands.map((name) => ({ name })));
        if (error) console.error(`No se pudieron agregar las marcas nuevas: ${error.message}`);
    }

    console.log(`\nListo: ${rows.length} perfumes cargados (con stock ${initialStock}), ${newBrands.length} marcas nuevas.`);
    if (rows.length < nuevos.length) console.log(`${nuevos.length - rows.length} se saltaron porque ya estaban en la base.`);
}

(process.argv.includes("--apply") ? apply() : preview()).catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
});
