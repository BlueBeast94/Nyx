// ===== Chat widget copy — replace these with real info whenever it's ready =====
const CHAT_RESPONSES = {
    precios:
        "Los precios varían según el perfume. Podés verlos en cada producto del catálogo, o escribinos por WhatsApp para más info.",
    envios: "Coordinamos el envío según tu ubicación — escribinos por WhatsApp para más detalles.",
    promociones:
        "Por el momento no tenemos promociones activas, pero seguinos por WhatsApp para enterarte de las próximas.",
    recomendaciones: "¡Esta función va a usar IA para recomendarte el perfume ideal! La estamos preparando 🚀"
};

const CHAT_OPTIONS = [
    { key: "precios", label: "1) Precios" },
    { key: "envios", label: "2) Envíos" },
    { key: "promociones", label: "3) Promociones" },
    { key: "recomendaciones", label: "4) Recomendaciones" }
];

// Asked in order for the AI recommendation flow — kept to 4 questions, all button-based.
const RECOMMENDATION_QUESTIONS = [
    {
        question: "¿Buscás algo para invierno o para verano?",
        choices: ["Invierno", "Verano", "Cualquier estación"]
    },
    {
        question: "¿Preferís algo dulce, frutal, amaderado o floral?",
        choices: ["Dulce", "Frutal", "Amaderado", "Floral"]
    },
    {
        question: "¿Es para uso de día o de noche?",
        choices: ["Día", "Noche", "Cualquiera"]
    },
    {
        question: "¿Buscás algo masculino, femenino o unisex?",
        choices: ["Masculino", "Femenino", "Unisex", "Cualquiera"]
    }
];

const chatWidgetBtn = document.getElementById("chatWidgetBtn");
const chatWidgetPanel = document.getElementById("chatWidgetPanel");
const closeChatWidget = document.getElementById("closeChatWidget");
const chatWidgetMessages = document.getElementById("chatWidgetMessages");
const chatWidgetInputArea = document.getElementById("chatWidgetInputArea");

let chatStarted = false;
let userName = "";
let recommendationAnswers = [];

function scrollChatToBottom() {
    // Runs after the browser has laid out the (possibly taller/shorter) input area,
    // so the latest message doesn't end up hidden behind it.
    requestAnimationFrame(() => {
        chatWidgetMessages.scrollTop = chatWidgetMessages.scrollHeight;
    });
}

function addChatMessage(text, from) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${from}`;
    msg.textContent = text;
    chatWidgetMessages.appendChild(msg);
    scrollChatToBottom();
}

function setChatInputArea(html) {
    chatWidgetInputArea.innerHTML = html;
    scrollChatToBottom();
}

function showNameStep() {
    setChatInputArea(`
        <form class="chat-name-form" id="chatNameForm">
            <input type="text" id="chatNameInput" placeholder="Tu nombre..." autocomplete="off" required/>
            <button type="submit">Enviar</button>
        </form>
    `);
    document.getElementById("chatNameForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("chatNameInput");
        const name = input.value.trim();
        if (!name) return;
        userName = name;
        addChatMessage(name, "user");
        showChatMenu();
    });
}

function showChatMenu() {
    addChatMessage(`¡Un gusto, ${userName}! Escribime cualquier pregunta, o elegí una opción:`, "bot");
    renderMenuInputs();
}

// Free-text box + the 4 quick-option buttons, always available together.
function renderMenuInputs() {
    setChatInputArea(`
        <div class="chat-menu-buttons">
            ${CHAT_OPTIONS.map((opt) => `<button type="button" class="chat-option-btn" data-option="${opt.key}">${opt.label}</button>`).join("")}
        </div>
        <form class="chat-name-form chat-freetext-form" id="chatFreeTextForm">
            <input type="text" id="chatFreeTextInput" placeholder="Escribí tu pregunta..." autocomplete="off"/>
            <button type="submit">➤</button>
        </form>
    `);

    document.getElementById("chatFreeTextForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("chatFreeTextInput");
        const question = input.value.trim();
        if (!question) return;
        addChatMessage(question, "user");
        input.value = "";
        askFreeTextQuestion(question);
    });

    chatWidgetInputArea.querySelectorAll(".chat-option-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            addChatMessage(btn.textContent, "user");
            if (btn.dataset.option === "recomendaciones") {
                startRecommendationFlow();
            } else {
                addChatMessage(CHAT_RESPONSES[btn.dataset.option], "bot");
                renderMenuInputs();
            }
        });
    });
}

async function askFreeTextQuestion(question) {
    setChatInputArea(`<p style="font-size:12px;color:#6e6a72;margin:0;">Pensando...</p>`);

    try {
        const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: question })
        });
        const data = await res.json();

        if (!res.ok || !data.answer) {
            throw new Error(data.error || "No se pudo responder");
        }

        addChatMessage(data.answer, "bot");
    } catch (err) {
        console.error("Failed to get chat answer:", err);
        addChatMessage("No pude responder justo ahora — probá de nuevo en un rato.", "bot");
    }

    renderMenuInputs();
}

// ===== AI recommendation flow =====
function startRecommendationFlow() {
    recommendationAnswers = [];
    addChatMessage("¡Buenísimo! Te hago un par de preguntas rápidas para recomendarte algo 🌟", "bot");
    askRecommendationQuestion(0);
}

function askRecommendationQuestion(index) {
    if (index >= RECOMMENDATION_QUESTIONS.length) {
        fetchRecommendations();
        return;
    }

    const q = RECOMMENDATION_QUESTIONS[index];
    addChatMessage(q.question, "bot");
    setChatInputArea(
        q.choices.map((choice) => `<button type="button" class="chat-option-btn" data-choice="${choice}">${choice}</button>`).join("")
    );

    chatWidgetInputArea.querySelectorAll(".chat-option-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            addChatMessage(btn.textContent, "user");
            recommendationAnswers.push({ question: q.question, answer: btn.dataset.choice });
            askRecommendationQuestion(index + 1);
        });
    });
}

async function fetchRecommendations() {
    addChatMessage("Buscando las mejores opciones para vos...", "bot");
    setChatInputArea("");

    try {
        const res = await fetch("/api/recommend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: recommendationAnswers })
        });
        const data = await res.json();

        if (!res.ok || !data.recommendations) {
            throw new Error(data.error || "No se pudo generar la recomendación");
        }

        addChatMessage(data.recommendations, "bot");
    } catch (err) {
        console.error("Failed to fetch recommendations:", err);
        addChatMessage("No pudimos generar recomendaciones justo ahora — probá de nuevo en un rato.", "bot");
    }

    renderMenuInputs();
}

function startChat() {
    if (chatStarted) return;
    chatStarted = true;
    addChatMessage("¡Hola! Decime tu nombre para empezar 😊", "bot");
    showNameStep();
}

chatWidgetBtn.addEventListener("click", () => {
    chatWidgetPanel.classList.remove("hidden");
    startChat();
});

closeChatWidget.addEventListener("click", () => {
    chatWidgetPanel.classList.add("hidden");
});
