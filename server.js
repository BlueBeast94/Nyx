require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { engine } = require("express-handlebars");
const { createClient } = require("@supabase/supabase-js");

const PERFUMES_BUCKET = "perfumes";

// @supabase/supabase-js's realtime client requires native WebSocket (Node 22+).
// Polyfill it so auth-only usage works on Node 20.
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = require("ws");
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Throwing (not process.exit) so this fails cleanly as a 500 under Vercel's serverless runtime too.
    throw new Error(
        "Missing Supabase config. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY " +
            "(locally via .env, on Vercel via Project Settings > Environment Variables)."
    );
}

// Optional — the chat widget's AI features (recommendations, free-text Q&A) degrade gracefully
// with a clear error if this isn't set, rather than blocking the whole app from starting.
if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY not set — the chat widget's AI features will return a friendly error until it is.");
}

// Used for user-facing auth (sign in) — respects RLS.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Used server-side only for admin operations (creating users, reading/writing profiles & perfumes).
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const app = express();

app.engine(
    "hbs",
    engine({
        extname: ".hbs",
        defaultLayout: false,
        helpers: {
            // Escape "<" so a value containing "</script>" can't break out of the embedding <script> tag.
            json: (context) => JSON.stringify(context).replace(/</g, "\\u003c")
        }
    })
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// Files are held in memory only long enough to stream them to Supabase Storage —
// no local disk writes, since Vercel's filesystem is read-only/ephemeral.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

async function ensurePerfumesBucket() {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!buckets?.some((b) => b.name === PERFUMES_BUCKET)) {
        await supabaseAdmin.storage.createBucket(PERFUMES_BUCKET, { public: true });
    }
}

async function uploadPerfumePhoto(file) {
    const ext = path.extname(file.originalname) || "";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    const { error } = await supabaseAdmin.storage
        .from(PERFUMES_BUCKET)
        .upload(filename, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from(PERFUMES_BUCKET).getPublicUrl(filename);
    return data.publicUrl;
}

// Grows the brand list automatically: adds the name if it's new (case-insensitive), no-ops if it already exists.
async function ensureBrandExists(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    const { data: existing } = await supabaseAdmin.from("brands").select("id").ilike("name", trimmed).maybeSingle();
    if (existing) return;

    const { error } = await supabaseAdmin.from("brands").insert({ name: trimmed });
    if (error) console.error("Failed to save new brand:", error.message);
}

// Reads brand names from a CSV, whether they're one per line, comma-separated on one line, or a mix of both.
// Skips a header row if it just says "name"/"marca"/"brand".
function parseCsvBrands(text) {
    return text
        .split(/[\r\n,]+/)
        .map((name) => name.trim().replace(/^"|"$/g, ""))
        .filter((name) => name && !/^(name|marca|brand)$/i.test(name));
}

// Reads "Brand,Perfume Name" rows for the reference perfume list. Skips a header row.
function parseCsvBrandPerfumes(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.split(","))
        .filter((cols) => cols.length >= 2)
        .map(([brand, name]) => ({
            brand: brand.trim().replace(/^"|"$/g, ""),
            name: name.trim().replace(/^"|"$/g, "")
        }))
        .filter(
            ({ brand, name }) =>
                brand && name && !(/^(brand|marca)$/i.test(brand) && /^(name|nombre|perfume|modelo)$/i.test(name))
        );
}

// Formats the current in-stock catalog into plain text for the AI's system prompt.
async function buildCatalogContext() {
    const { data: perfumes, error } = await supabaseAdmin
        .from("perfumes")
        .select("brand, model, gender, notes_top, notes_middle, notes_base, description, stock_quantity")
        .gte("stock_quantity", 1);

    if (error) {
        console.error("buildCatalogContext query error:", error.message);
        throw new Error("No se pudo leer el catálogo.");
    }

    if (!perfumes || perfumes.length === 0) {
        return "No hay perfumes en stock actualmente.";
    }

    return perfumes
        .map((p) => {
            const notes = [p.notes_top, p.notes_middle, p.notes_base].filter(Boolean).join(", ");
            const genderLine = p.gender ? `, género: ${p.gender}` : "";
            return `- ${p.brand || ""} ${p.model || ""} (notas: ${notes || "sin especificar"}${genderLine})`;
        })
        .join("\n");
}

// Groq's API is OpenAI-compatible — same request/response shape as the OpenAI chat completions endpoint.
async function callGroq(messages) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.6,
            max_tokens: 400
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
}

async function getSessionUser(req) {
    const token = req.cookies["sb-access-token"];
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return null;
    return data.user;
}

async function getProfile(user) {
    const { data: existing } = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (existing) return existing;

    // Bootstrap: the very first authenticated user (created directly in Supabase) becomes admin.
    const { count } = await supabaseAdmin.from("profiles").select("*", { count: "exact", head: true });
    const role = count === 0 ? "admin" : "vendor";
    const { data: created, error } = await supabaseAdmin
        .from("profiles")
        .insert({ id: user.id, email: user.email, role })
        .select()
        .single();

    if (error) {
        console.error("Failed to create profile row:", error.message);
        return { id: user.id, email: user.email, role };
    }
    return created;
}

async function requireAuth(req, res, next) {
    const user = await getSessionUser(req);
    if (!user) return res.redirect("/login");
    req.user = user;
    req.profile = await getProfile(user);
    next();
}

function requireAdmin(req, res, next) {
    if (req.profile.role !== "admin") {
        return res.status(403).send("Forbidden: admin access required.");
    }
    next();
}

app.get("/login", async (req, res) => {
    const user = await getSessionUser(req);
    if (user) return res.redirect("/dashboard");
    res.render("login", {});
});

// Public — lets the home page know whether to link to /login or /dashboard.
app.get("/api/session", async (req, res) => {
    const user = await getSessionUser(req);
    res.json({ loggedIn: !!user });
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        return res.render("login", { error: "Invalid email or password." });
    }

    res.cookie("sb-access-token", data.session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: data.session.expires_in * 1000
    });
    res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
    res.clearCookie("sb-access-token");
    res.redirect("/login");
});

app.get("/dashboard", requireAuth, async (req, res) => {
    const { data: perfumes } = await supabaseAdmin
        .from("perfumes")
        .select("*")
        .order("created_at", { ascending: false });

    const { data: brands } = await supabaseAdmin.from("brands").select("*").order("name");
    const { data: referencePerfumes } = await supabaseAdmin
        .from("reference_perfumes")
        .select("*")
        .order("brand")
        .order("name");

    let users = [];
    if (req.profile.role === "admin") {
        const { data } = await supabaseAdmin.from("profiles").select("*").order("created_at", { ascending: false });
        users = data || [];
    }

    res.render("dashboard", {
        email: req.user.email,
        role: req.profile.role,
        isAdmin: req.profile.role === "admin",
        perfumes: perfumes || [],
        brands: brands || [],
        referencePerfumes: referencePerfumes || [],
        users,
        userMsg: req.query.userMsg,
        userError: req.query.userError,
        perfumeMsg: req.query.perfumeMsg,
        perfumeError: req.query.perfumeError,
        brandMsg: req.query.brandMsg,
        brandError: req.query.brandError
    });
});

app.post("/dashboard/users", requireAuth, requireAdmin, async (req, res) => {
    const { email, password, role } = req.body;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (error) {
        return res.redirect(`/dashboard?userError=${encodeURIComponent(error.message)}#usuarios`);
    }

    const { error: profileError } = await supabaseAdmin.from("profiles").insert({ id: data.user.id, email, role });
    if (profileError) {
        return res.redirect(`/dashboard?userError=${encodeURIComponent(profileError.message)}#usuarios`);
    }

    res.redirect("/dashboard?userMsg=Usuario creado#usuarios");
});

app.post("/dashboard/perfumes", requireAuth, upload.single("photo"), async (req, res) => {
    const { brand, model, gender, stockQuantity, notesTop, notesMiddle, notesBase, description } = req.body;

    let imageUrl = null;
    if (req.file) {
        try {
            imageUrl = await uploadPerfumePhoto(req.file);
        } catch (err) {
            return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(err.message)}#inventario`);
        }
    }

    const { error } = await supabaseAdmin.from("perfumes").insert({
        name: model || brand || "Sin nombre",
        brand,
        model,
        gender: gender || null,
        stock_quantity: Math.max(0, parseInt(stockQuantity, 10) || 0),
        image_url: imageUrl,
        notes_top: notesTop,
        notes_middle: notesMiddle,
        notes_base: notesBase,
        description
    });

    if (error) {
        return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(error.message)}#inventario`);
    }

    await ensureBrandExists(brand);

    res.redirect("/dashboard?perfumeMsg=Perfume agregado#inventario");
});

app.post("/dashboard/perfumes/:id", requireAuth, upload.single("photo"), async (req, res) => {
    const { id } = req.params;
    const { brand, model, gender, stockQuantity, notesTop, notesMiddle, notesBase, description } = req.body;

    const updates = {
        name: model || brand || "Sin nombre",
        brand,
        model,
        gender: gender || null,
        stock_quantity: Math.max(0, parseInt(stockQuantity, 10) || 0),
        notes_top: notesTop,
        notes_middle: notesMiddle,
        notes_base: notesBase,
        description
    };

    if (req.file) {
        try {
            updates.image_url = await uploadPerfumePhoto(req.file);
        } catch (err) {
            return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(err.message)}#inventario`);
        }
    }

    const { error } = await supabaseAdmin.from("perfumes").update(updates).eq("id", id);

    if (error) {
        return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(error.message)}#inventario`);
    }

    await ensureBrandExists(brand);

    res.redirect("/dashboard?perfumeMsg=Perfume actualizado#inventario");
});

app.post("/dashboard/perfumes/:id/delete", requireAuth, async (req, res) => {
    const { error } = await supabaseAdmin.from("perfumes").delete().eq("id", req.params.id);

    if (error) {
        return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(error.message)}#inventario`);
    }

    res.redirect("/dashboard?perfumeMsg=Perfume eliminado#inventario");
});

// Catálogo's quantity-only edit — updates stock_quantity without touching the rest of the perfume.
app.post("/dashboard/perfumes/:id/quantity", requireAuth, async (req, res) => {
    const { quantity } = req.body;

    const { error } = await supabaseAdmin
        .from("perfumes")
        .update({ stock_quantity: Math.max(0, parseInt(quantity, 10) || 0) })
        .eq("id", req.params.id);

    if (error) {
        return res.redirect(`/dashboard?perfumeError=${encodeURIComponent(error.message)}#catalogo`);
    }

    res.redirect("/dashboard?perfumeMsg=Cantidad actualizada#catalogo");
});

app.post("/dashboard/brands", requireAuth, async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) {
        return res.redirect("/dashboard?brandError=El nombre no puede estar vacío#marcas");
    }

    const { data: existing } = await supabaseAdmin.from("brands").select("id").ilike("name", name).maybeSingle();
    if (existing) {
        return res.redirect("/dashboard?brandError=Esa marca ya existe#marcas");
    }

    const { error } = await supabaseAdmin.from("brands").insert({ name });
    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#marcas`);
    }

    res.redirect("/dashboard?brandMsg=Marca agregada#marcas");
});

app.post("/dashboard/brands/import", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.redirect("/dashboard?brandError=Seleccioná un archivo CSV#marcas");
    }

    const names = parseCsvBrands(req.file.buffer.toString("utf-8"));
    if (names.length === 0) {
        return res.redirect("/dashboard?brandError=El archivo no tiene marcas válidas#marcas");
    }

    // Dedupe case-insensitively within the file itself ("DIOR"/"dior"/"Dior" -> one), keeping the first casing seen.
    const seen = new Map();
    for (const name of names) {
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, name);
    }

    // Skip any that already exist in the database, also case-insensitively.
    const { data: existingBrands } = await supabaseAdmin.from("brands").select("name");
    const existingLower = new Set((existingBrands || []).map((b) => b.name.toLowerCase()));

    const toInsert = [...seen.entries()]
        .filter(([key]) => !existingLower.has(key))
        .map(([, name]) => ({ name }));

    if (toInsert.length === 0) {
        return res.redirect("/dashboard?brandMsg=No hay marcas nuevas para agregar#marcas");
    }

    const { error } = await supabaseAdmin.from("brands").insert(toInsert);

    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#marcas`);
    }

    res.redirect(`/dashboard?brandMsg=${encodeURIComponent(`${toInsert.length} marcas nuevas agregadas`)}#marcas`);
});

app.post("/dashboard/brands/:id/delete", requireAuth, async (req, res) => {
    const { error } = await supabaseAdmin.from("brands").delete().eq("id", req.params.id);
    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#marcas`);
    }
    res.redirect("/dashboard?brandMsg=Marca eliminada#marcas");
});

// Reference list of known perfume names per brand — used to auto-suggest "Modelo" when adding a perfume.
app.post("/dashboard/reference-perfumes", requireAuth, async (req, res) => {
    const brand = (req.body.brand || "").trim();
    const name = (req.body.name || "").trim();

    if (!brand || !name) {
        return res.redirect("/dashboard?brandError=Marca y nombre son obligatorios#modelos");
    }

    const { error } = await supabaseAdmin.from("reference_perfumes").insert({ brand, name });
    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#modelos`);
    }

    res.redirect("/dashboard?brandMsg=Perfume de referencia agregado#modelos");
});

app.post("/dashboard/reference-perfumes/import", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.redirect("/dashboard?brandError=Seleccioná un archivo CSV#modelos");
    }

    const rows = parseCsvBrandPerfumes(req.file.buffer.toString("utf-8"));
    if (rows.length === 0) {
        return res.redirect("/dashboard?brandError=El archivo no tiene filas válidas (Marca,Nombre)#modelos");
    }

    // Dedupe within the file itself, case-insensitively.
    const seen = new Map();
    for (const row of rows) {
        const key = `${row.brand.toLowerCase()}||${row.name.toLowerCase()}`;
        if (!seen.has(key)) seen.set(key, row);
    }

    // Skip pairs that already exist in the database.
    const { data: existing } = await supabaseAdmin.from("reference_perfumes").select("brand, name");
    const existingKeys = new Set((existing || []).map((r) => `${r.brand.toLowerCase()}||${r.name.toLowerCase()}`));

    const toInsert = [...seen.values()].filter(
        (row) => !existingKeys.has(`${row.brand.toLowerCase()}||${row.name.toLowerCase()}`)
    );

    if (toInsert.length === 0) {
        return res.redirect("/dashboard?brandMsg=No hay perfumes de referencia nuevos para agregar#modelos");
    }

    const { error } = await supabaseAdmin.from("reference_perfumes").insert(toInsert);
    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#modelos`);
    }

    res.redirect(`/dashboard?brandMsg=${encodeURIComponent(`${toInsert.length} perfumes de referencia nuevos agregados`)}#modelos`);
});

app.post("/dashboard/reference-perfumes/:id/delete", requireAuth, async (req, res) => {
    const { error } = await supabaseAdmin.from("reference_perfumes").delete().eq("id", req.params.id);
    if (error) {
        return res.redirect(`/dashboard?brandError=${encodeURIComponent(error.message)}#modelos`);
    }
    res.redirect("/dashboard?brandMsg=Perfume de referencia eliminado#modelos");
});

// Public, read-only — powers the storefront grid on the home page.
app.get("/api/perfumes", async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from("perfumes")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

// Public — the chat widget's free-text Q&A, grounded in the current in-stock catalog.
app.post("/api/chat", async (req, res) => {
    if (!process.env.GROQ_API_KEY) {
        return res.status(503).json({ error: "El asistente de IA no está configurado todavía." });
    }

    const { message } = req.body;
    if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Falta el mensaje." });
    }

    try {
        const catalogContext = await buildCatalogContext();
        const systemPrompt =
            "Sos el asistente virtual de NYX, una tienda de perfumes. Respondé en español, de forma breve y amable. " +
            "Solo podés hablar de los perfumes que aparecen en la siguiente lista de stock actual — no inventes perfumes que no estén ahí. " +
            "Si preguntan por algo que no está en la lista, decilo honestamente y sugerí algo similar de la lista si existe. " +
            "Si tu respuesta recomienda o menciona uno o más perfumes puntuales, listalos cada uno en su propia línea " +
            "empezando con '- ', con el nombre (marca + modelo) entre doble asterisco, seguido de una razón breve. " +
            "Ejemplo: '- **Al Wataniah Alal** — ideal si buscás algo unisex y frutal.' " +
            "Para respuestas que no impliquen recomendar perfumes puntuales, respondé en prosa normal, sin listas.\n\n" +
            `Stock actual:\n${catalogContext}`;

        const answer = await callGroq([
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
        ]);

        res.json({ answer });
    } catch (err) {
        console.error("Chat AI error:", err.message);
        res.status(500).json({ error: "No se pudo generar una respuesta." });
    }
});

// Public — the chat widget's structured 4-question recommendation flow.
app.post("/api/recommend", async (req, res) => {
    if (!process.env.GROQ_API_KEY) {
        return res.status(503).json({ error: "El asistente de IA no está configurado todavía." });
    }

    const { answers } = req.body;
    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: "Faltan las respuestas." });
    }

    try {
        const catalogContext = await buildCatalogContext();
        const preferencesText = answers.map((a) => `${a.question} ${a.answer}`).join("\n");

        const systemPrompt =
            "Sos el asistente virtual de NYX, una tienda de perfumes. Basándote ÚNICAMENTE en la siguiente lista de stock actual, " +
            "recomendá entre 3 y 5 perfumes que mejor se ajusten a las preferencias del cliente. " +
            "Respondé en español. Cada perfume va en su propia línea, empezando con '- ', con el nombre (marca + modelo) " +
            "entre doble asterisco, seguido de una razón breve de una línea. Ejemplo de línea: " +
            "'- **Al Wataniah Alal** — ideal para vos porque es unisex y frutal.' " +
            "No agregues introducción ni cierre, solo la lista. No inventes perfumes que no estén en la lista.\n\n" +
            `Stock actual:\n${catalogContext}`;

        const recommendations = await callGroq([
            { role: "system", content: systemPrompt },
            { role: "user", content: `Mis preferencias:\n${preferencesText}` }
        ]);

        res.json({ recommendations });
    } catch (err) {
        console.error("Recommend AI error:", err.message);
        res.status(500).json({ error: "No se pudo generar la recomendación." });
    }
});

ensurePerfumesBucket().catch((err) => console.error("Could not verify/create Supabase Storage bucket:", err.message));

// Vercel imports this file as a serverless function handler — it must not call app.listen() there.
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`NYX server running at http://localhost:${PORT}`);
    });
}

module.exports = app;
