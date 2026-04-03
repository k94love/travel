const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const geminiKey = defineSecret('GEMINI_KEY');

exports.translateMenu = onRequest(
    {
        secrets: [geminiKey],
        cors: ['https://trip-a4f93.web.app', 'https://trip-a4f93.firebaseapp.com'],
        region: 'asia-east1'
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey.value()}`;

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ error: { message: e.message } });
        }
    }
);
