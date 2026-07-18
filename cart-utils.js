// ===== Shared helpers (used by both index.html and cart.html) =====
const CART_STORAGE_KEY = "nyxCart";
const WHATSAPP_NUMBER = "541127122853";

function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function genderLabel(gender) {
    if (gender === "masculino") return "Masculino";
    if (gender === "femenino") return "Femenino";
    if (gender === "unisex") return "Unisex";
    return "";
}

function genderBadgeClasses(gender) {
    if (gender === "masculino") return "bg-blue-500/25 text-blue-200";
    if (gender === "femenino") return "bg-pink-500/25 text-pink-200";
    if (gender === "unisex") return "bg-purple-500/25 text-purple-200";
    return "bg-black/50 text-white";
}

// Toggles an "Agregar a Carrito" button between its default and already-added (checked) states.
// Once added, it stays checked/disabled — quantity changes happen on the Carrito page instead.
function setCartButtonState(btn, inCart) {
    const icon = btn.querySelector(".material-symbols-outlined");
    btn.disabled = inCart;
    if (inCart) {
        btn.setAttribute("aria-label", "Ya está en el carrito");
        btn.classList.remove(
            "bg-white/5",
            "border-white/15",
            "text-on-surface",
            "hover:bg-primary",
            "hover:border-primary",
            "hover:text-on-primary",
            "cursor-pointer"
        );
        btn.classList.add("bg-green-500/15", "border-green-400/40", "text-green-300", "cursor-default");
        if (icon) icon.textContent = "check";
    } else {
        btn.setAttribute("aria-label", "Agregar a carrito");
        btn.classList.remove("bg-green-500/15", "border-green-400/40", "text-green-300", "cursor-default");
        btn.classList.add(
            "bg-white/5",
            "border-white/15",
            "text-on-surface",
            "hover:bg-primary",
            "hover:border-primary",
            "hover:text-on-primary",
            "cursor-pointer"
        );
        if (icon) icon.textContent = "add_shopping_cart";
    }
}

// ===== Cart storage: { [perfumeId]: quantity } =====
function getCart() {
    try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.error("Failed to read cart:", err);
        return {};
    }
}

function saveCart(cart) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartBadge();
}

function addToCart(id, qty = 1) {
    const cart = getCart();
    cart[id] = (cart[id] || 0) + qty;
    saveCart(cart);
}

function setCartQuantity(id, qty) {
    const cart = getCart();
    if (qty <= 0) {
        delete cart[id];
    } else {
        cart[id] = qty;
    }
    saveCart(cart);
}

function removeFromCart(id) {
    const cart = getCart();
    delete cart[id];
    saveCart(cart);
}

function clearCart() {
    saveCart({});
}

function isInCart(id) {
    return !!getCart()[id];
}

function getCartCount() {
    const cart = getCart();
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

function updateCartBadge() {
    const badge = document.getElementById("cartBadge");
    if (!badge) return;
    const count = getCartCount();
    badge.textContent = count;
    badge.classList.toggle("hidden", count === 0);
}

// Builds the WhatsApp "Encargar" link for a list of { brand, name, gender, quantity, price } items.
function buildWhatsAppOrderUrl(items) {
    const lines = items.map((item) => {
        const genderAbbrev = item.gender === "masculino" ? "M" : item.gender === "femenino" ? "F" : "";
        const genderPart = genderAbbrev ? `, ${genderAbbrev}` : "";
        const brandPart = item.brand ? `${item.brand} ` : "";
        return `-${brandPart}${item.name}${genderPart} x${item.quantity}`;
    });

    let message = `Hola!\nMe interesa encargar estos perfumes que vi en stock\n${lines.join("\n")}`;

    const allHavePrices = items.length > 0 && items.every((item) => item.price != null);
    if (allHavePrices) {
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        message += `\n\nTotal: $${total}`;
    }

    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// ===== Toast =====
let toastHideTimeout = null;

function showToast(message) {
    let toast = document.getElementById("nyxToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "nyxToast";
        toast.className = "toast";
        toast.innerHTML = `<span class="material-symbols-outlined">check_circle</span><span id="nyxToastMessage"></span>`;
        document.body.appendChild(toast);
    }

    toast.querySelector("#nyxToastMessage").textContent = message;
    toast.classList.add("visible");

    clearTimeout(toastHideTimeout);
    toastHideTimeout = setTimeout(() => {
        toast.classList.remove("visible");
    }, 2200);
}

document.addEventListener("DOMContentLoaded", updateCartBadge);
