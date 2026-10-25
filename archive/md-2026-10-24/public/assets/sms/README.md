# SMS / MMS media

Drop public HTTPS-reachable images here (client results, screenshots, memes).

Twilio only accepts `https://` MediaUrl values. After deploy, URLs look like:

`https://fundhub.ai/assets/sms/your-file.png`

Wire them on a message as `mediaUrls: ["https://fundhub.ai/assets/sms/your-file.png"]`.
No meme files ship by default — owner drops assets when ready.
