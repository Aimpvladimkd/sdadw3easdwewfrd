const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const cors = require('cors'); // Разрешает запросы с других сайтов

const app = express();

// --- НАСТРОЙКИ ---
app.use(bodyParser.json());

// ВАЖНО: Разрешаем твоему сайту делать запросы к этому серверу
app.use(cors({ origin: '*' })); 

// Инициализация Firebase
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log("Firebase initialized");
    } catch (e) {
        console.error("Firebase Key Error:", e);
    }
}
const db = admin.apps.length ? getFirestore() : null;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Проверка, что сервер жив
app.get('/', (req, res) => {
    res.send('Payment Server is Running. Use POST /create-invoice');
});

// --- 1. СОЗДАНИЕ ССЫЛКИ (Вызывается из deposit.html) ---
app.post('/create-invoice', async (req, res) => {
    const { userId, amount } = req.body;
    
    if (!userId || !amount) {
        return res.status(400).json({ ok: false, error: 'No data provided' });
    }

    try {
        const payload = {
            title: "Deposit BLYX",
            description: `Top up ${amount} BLYX`,
            payload: JSON.stringify({ userId, amount }), 
            currency: "XTR",
            prices: [{ label: "BLYX", amount: parseInt(amount) }], // 1 Star = 1 XTR
            provider_token: "" // Пустой для Stars
        };

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await tgRes.json();
        
        if (!data.ok) {
            console.error("Telegram Error:", data);
            throw new Error(data.description);
        }
        
        res.json({ ok: true, link: data.result });

    } catch (e) {
        console.error("Server Error:", e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// --- 2. ВЕБХУК (Сюда стучится Telegram после оплаты) ---
app.post('/webhook', async (req, res) => {
    const update = req.body;

    // A. Pre-checkout (Telegram спрашивает: можно принимать?)
    if (update.pre_checkout_query) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                pre_checkout_query_id: update.pre_checkout_query.id, 
                ok: true 
            })
        });
        return res.send('OK');
    }

    // B. Successful Payment (Деньги списались)
    if (update.message?.successful_payment) {
        const payment = update.message.successful_payment;
        const info = JSON.parse(payment.invoice_payload); // Достаем userId и amount
        
        if (payment.currency === 'XTR' && db) {
            const userIdStr = String(info.userId);
            const amountVal = parseInt(info.amount);

            console.log(`User ${userIdStr} paid ${amountVal} Stars`);

            // Обновляем баланс 1 к 1
            await db.collection('users').doc(userIdStr).set({
                balance: admin.firestore.FieldValue.increment(amountVal), // +BLYX
                // Если нужно считать сами звезды отдельно, раскомментируй строку ниже:
                // starsDeposited: admin.firestore.FieldValue.increment(amountVal)
            }, { merge: true });
        }
    }
    
    res.send('Processed');
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));