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

        const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'];
        const model = ALLOWED_MODELS.includes(req.body?.model) ? req.body.model : 'gemini-3.1-flash-lite-preview';
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey.value()}`;

        try {
            const { model: _model, ...bodyToForward } = req.body;
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyToForward)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ error: { message: e.message } });
        }
    }
);
