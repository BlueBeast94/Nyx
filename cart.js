function splitNotes(str) {
    return (str || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function transformPerfume(row) {
    return {
        id: row.id,
        name: row.model || row.name,
        brand: row.brand,
        gender: row.gender,
        price: row.price ?? null,
        inStock: row.stock_quantity != null ? row.stock_quantity >= 1 : null,
        image: row.image_url
    };
}

const cartItemsEl = document.getElementById("cartItems");
const cartEmptyState = document.getElementById("cartEmptyState");
const cartSummary = document.getElementById("cartSummary");
const totalAmountEl = document.getElementById("totalAmount");
const encargarBtn = document.getElementById("encargarBtn");
const clearCartBtn = document.getElementById("clearCartBtn");

let allPerfumes = [];

async function loadCartPage() {
    try {
        const res = await fetch("/api/perfumes");
        const data = await res.json();
        allPerfumes = Array.isArray(data) ? data.map(transformPerfume) : [];
    } catch (err) {
        console.error("Failed to load perfumes:", err);
        allPerfumes = [];
    }
    renderCart();
}

function getCartItems() {
    const cart = getCart();
    return Object.entries(cart)
        .map(([id, quantity]) => {
            const perfume = allPerfumes.find((p) => p.id === id);
            return perfume ? { ...perfume, quantity } : null;
        })
        .filter(Boolean);
}

function renderCart() {
    const items = getCartItems();

    cartItemsEl.innerHTML = "";
    cartEmptyState.classList.toggle("hidden", items.length > 0);
    cartSummary.classList.toggle("hidden", items.length === 0);

    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "flex gap-4 items-center bg-surface-container rounded-xl p-4 border border-white/5";
        row.innerHTML = `
            <div class="w-16 h-20 rounded-lg overflow-hidden bg-surface-container-high flex items-center justify-center shrink-0">
                ${
                    item.image
                        ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover"/>`
                        : `<span class="text-[8px] text-on-surface-variant uppercase">N/A</span>`
                }
            </div>
            <div class="flex-1 min-w-0">
                <p class="font-label-sm text-[10px] text-primary tracking-[0.2em] uppercase">${escapeHtml(item.brand) || "NYX"}</p>
                <h3 class="font-display-lg text-base text-on-surface truncate">${escapeHtml(item.name)}</h3>
                <div class="flex items-center gap-2 mt-1">
                    ${item.gender ? `<span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${genderBadgeClasses(item.gender)}">${escapeHtml(genderLabel(item.gender))}</span>` : ""}
                    ${item.price != null ? `<span class="text-xs text-on-surface-variant">$${item.price} c/u</span>` : ""}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button type="button" class="qty-btn w-7 h-7 rounded-full border border-white/15 text-on-surface hover:border-primary transition-colors" data-action="decrease">−</button>
                <span class="w-6 text-center text-sm">${item.quantity}</span>
                <button type="button" class="qty-btn w-7 h-7 rounded-full border border-white/15 text-on-surface hover:border-primary transition-colors" data-action="increase">+</button>
            </div>
            <button type="button" class="remove-btn text-on-surface-variant hover:text-red-300 transition-colors shrink-0" aria-label="Eliminar">
                <span class="material-symbols-outlined text-lg">delete</span>
            </button>
        `;

        row.querySelector('[data-action="decrease"]').addEventListener("click", () => {
            setCartQuantity(item.id, item.quantity - 1);
            renderCart();
        });
        row.querySelector('[data-action="increase"]').addEventListener("click", () => {
            setCartQuantity(item.id, item.quantity + 1);
            renderCart();
        });
        row.querySelector(".remove-btn").addEventListener("click", () => {
            removeFromCart(item.id);
            renderCart();
        });

        cartItemsEl.appendChild(row);
    });

    const allHavePrices = items.length > 0 && items.every((item) => item.price != null);
    totalAmountEl.textContent = allHavePrices
        ? `$${items.reduce((sum, item) => sum + item.price * item.quantity, 0)}`
        : "A confirmar";

    encargarBtn.onclick = () => {
        window.open(buildWhatsAppOrderUrl(items), "_blank", "noopener,noreferrer");
    };
}

clearCartBtn.addEventListener("click", () => {
    clearCart();
    renderCart();
});

loadCartPage();
