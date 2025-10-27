//1. TUODAAN TARVITTAVAT MODUULIT
import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas, registerFont } from "canvas";
import "dotenv/config";
import nodemailer from "nodemailer";

//2. ALUSTETAAN MUUTTUJAT
const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const app = express();
const signatures = new Map();
const paidSessions = new Set();

// Vaihtoehtoinen Gmail-konfiguraatio
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "handwrittensignaturegenerator@gmail.com", // Tavallinen Gmail-osoite
    pass: process.env.EMAIL_PASSWORD, // Sovellussalasana
  },
  debug: true,
  logger: true,
});

// Testaa SMTP-yhteyttä käynnistyksen yhteydessä
transporter.verify(function (error, success) {
  if (error) {
    console.error("SMTP connection error:", error);
  } else {
    console.log("SMTP server is ready to take our messages");
  }
});

//3. MIDDLEWARE MÄÄRITTELYT
app.use(cors());
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Blog proxy middleware
app.use("/blog", async (req, res) => {
  const { httpProxy } = await import("http-proxy-middleware");

  const proxy = httpProxy.createProxyMiddleware({
    target: "https://blog.handwrittensignaturegenerator.com",
    changeOrigin: true,
    pathRewrite: {
      "^/blog": "", // Poista /blog polusta
    },
    onProxyReq: (proxyReq, req, res) => {
      // Lisää oikeat headerit
      proxyReq.setHeader("host", "blog.handwrittensignaturegenerator.com");
    },
    onProxyRes: (proxyRes, req, res) => {
      // Poista cache-headereitä admin-sivuille
      if (req.path.includes("wp-admin") || req.path.includes("wp-login")) {
        proxyRes.headers["cache-control"] = "no-store";
      }
    },
  });

  proxy(req, res);
});

//4. FONTTIEN REKISTERÖINTI JA HALLINTA
registerFont(path.join(__dirname, "../public/fonts2/poppins.ttf"), {
  family: "Poppins",
});

const fontsDir = path.join(__dirname, "../public/fonts");
const signatureFonts = [];

try {
  if (fs.existsSync(fontsDir)) {
    const fontFiles = fs.readdirSync(fontsDir);
    console.log("Available fonts:", fontFiles);

    fontFiles.forEach((fontFile) => {
      if (fontFile.endsWith(".ttf")) {
        const fontName = fontFile.replace(".ttf", "").replace(/[-_]/g, " ");
        const fontFamily = fontName.replace(/\s+/g, "");
        console.log(`Registering font: ${fontFile} named ${fontFamily}`);
        registerFont(path.join(fontsDir, fontFile), { family: fontFamily });

        signatureFonts.push({
          name: fontName.toLowerCase(),
          font:
            fontName.toLowerCase() === "omafontti1"
              ? `155px '${fontFamily}'` // omafontti1 saa koon 155px
              : fontName.toLowerCase() === "omafontti2"
              ? `155px '${fontFamily}'` // omafontti2 saa koon 130px
              : fontName.toLowerCase() === "omafontti3"
              ? `120px '${fontFamily}'` // omafontti3 saa koon 120px
              : fontName.toLowerCase() === "omafontti5"
              ? `100px '${fontFamily}'` // omafontti5 saa koon 100px
              : fontName.toLowerCase() === "omafontti4"
              ? `60px '${fontFamily}'` // omafontti4 saa koon 60px
              : `40px '${fontFamily}'`, // kaikki muut saavat koon 40px
        });
      }
    });
  } else {
    console.log("Fonts-kansiota ei löydy:", fontsDir);
  }

  if (signatureFonts.length === 0) {
    console.log("No fonts found, using default fonts");
    signatureFonts.push(
      { name: "Arial", font: "40px Arial, sans-serif" },
      { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
      { name: "Courier New", font: "40px 'Courier New', monospace" }
    );
  }
} catch (error) {
  console.error("Error loading fonts:", error);
  signatureFonts.push(
    { name: "Arial", font: "40px Arial, sans-serif" },
    { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
    { name: "Courier New", font: "40px 'Courier New', monospace" }
  );
}

//6. ALLEKIRJOITUSTEN LUONTIFUNKTIOT
function createSignatureWithoutWatermark(name, fontStyle, color = "black") {
  // Käytä 4x isompaa canvas-kokoa korkealaatuisempia allekirjoituksia varten
  const scaleFactor = 4;
  const canvas = createCanvas(600 * scaleFactor, 200 * scaleFactor);
  const ctx = canvas.getContext("2d");

  // Paranna tekstin renderöintiä
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Tyhjennä canvas läpinäkyväksi (ei valkoista taustaa)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Määritä maksimileveys (90% canvaksen leveydestä)
  const maxWidth = canvas.width * 0.9;

  // Hae alkuperäinen fonttikoko ja skaalaa se
  const originalFontSize = parseInt(fontStyle.font.match(/\d+/)[0]);
  let fontSize = originalFontSize * scaleFactor;

  // Aseta alustava fontti
  ctx.font = fontStyle.font.replace(/\d+px/, `${fontSize}px`);
  // Käytä täysin peittävää sinistä, jos väri on sininen
  ctx.fillStyle = color === "blue" ? "rgba(2, 2, 255, 1.0)" : color;

  // Mittaa tekstin leveys
  let textWidth = ctx.measureText(name).width;

  // Jos teksti on liian leveä, pienennä fonttikokoa kunnes se mahtuu
  if (textWidth > maxWidth) {
    // Laske sopiva fonttikoko
    fontSize = Math.floor(
      originalFontSize * scaleFactor * (maxWidth / textWidth)
    );

    // Päivitä fontti uudella koolla
    const newFont = fontStyle.font.replace(/\d+px/, `${fontSize}px`);
    ctx.font = newFont;

    // Mittaa uudelleen varmistaaksesi
    textWidth = ctx.measureText(name).width;
  }

  // Mittaa tekstin korkeus
  const textMetrics = ctx.measureText(name);
  const actualHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  // Keskitä teksti pystysuunnassa
  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  // Säädä viivan paksuutta skaalautuvaksi mutta ohuemmaksi
  ctx.lineWidth = 1.5; // Heikerpi viiva
  ctx.strokeStyle = color === "blue" ? "rgba(2, 2, 255, 1.0)" : color; // Sama väri kuin täyttö

  // Piirrä teksti
  ctx.fillText(name, canvas.width / 2, centerY);
  ctx.strokeText(name, canvas.width / 2, centerY); // Lisää ääriviiva

  // Palauta PNG läpinäkyvällä taustalla korkealla laadulla
  return canvas.toDataURL("image/png");
}

function createSignature(name, fontStyle, color = "black") {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  // Aseta valkoinen tausta esikatseluun (vesileimalla)
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Lisää vesileima
  ctx.font = "bold 16px 'Poppins'";
  ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
  ctx.textAlign = "center";

  const watermarkPositions = [
    { x: canvas.width * 0.2, y: canvas.height * 0.3, angle: -15 },
    { x: canvas.width * 0.5, y: canvas.height * 0.5, angle: 10 },
    { x: canvas.width * 0.8, y: canvas.height * 0.3, angle: -20 },
    { x: canvas.width * 0.3, y: canvas.height * 0.7, angle: 15 },
    { x: canvas.width * 0.7, y: canvas.height * 0.8, angle: -10 },
  ];

  watermarkPositions.forEach((pos) => {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate((pos.angle * Math.PI) / 180);
    ctx.fillText("WATERMARK", 0, 0);
    ctx.restore();
  });

  // Määritä maksimileveys (90% canvaksen leveydestä)
  const maxWidth = canvas.width * 0.9;

  // Hae alkuperäinen fonttikoko
  const originalFontSize = parseInt(fontStyle.font.match(/\d+/)[0]);
  let fontSize = originalFontSize;

  // Aseta alustava fontti
  ctx.font = fontStyle.font;
  // Käytä täysin peittävää sinistä, jos väri on sininen
  ctx.fillStyle = color === "blue" ? "rgba(2, 2, 255, 1.0)" : color;
  ctx.textAlign = "center";

  // Mittaa tekstin leveys
  let textWidth = ctx.measureText(name).width;

  // Jos teksti on liian leveä, pienennä fonttikokoa kunnes se mahtuu
  if (textWidth > maxWidth) {
    // Laske sopiva fonttikoko
    fontSize = Math.floor(originalFontSize * (maxWidth / textWidth));

    // Päivitä fontti uudella koolla
    const newFont = fontStyle.font.replace(/\d+px/, `${fontSize}px`);
    ctx.font = newFont;

    // Mittaa uudelleen varmistaaksesi
    textWidth = ctx.measureText(name).width;
  }

  // Mittaa tekstin korkeus
  const textMetrics = ctx.measureText(name);
  const actualHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  // Keskitä teksti pystysuunnassa
  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  // Säädä viivan paksuutta ohuemmaksi
  ctx.lineWidth = 0.5; // Ohuempi viiva
  ctx.strokeStyle = color === "blue" ? "rgba(2, 2, 255, 1.0)" : color; // Sama väri kuin täyttö

  // Piirrä teksti
  ctx.fillText(name, canvas.width / 2, centerY);
  ctx.strokeText(name, canvas.width / 2, centerY); // Lisää ääriviiva

  return canvas.toDataURL("image/png");
}

//7. API REITIT

// Allekirjoitusten tilan tarkistus
app.get("/api/check-signatures", (req, res) => {
  const sessionId = req.query.sessionId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  const hasSignatures = signatures.has(sessionId);
  const hasPaid = paidSessions.has(sessionId);

  console.log(
    `Checking status for session: ${sessionId}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
  );

  res.json({
    hasSignatures,
    hasPaid,
    canDownload: hasSignatures && hasPaid,
  });
});

// Allekirjoitusten luonti
app.post("/api/create-signatures", (req, res) => {
  const { name, color } = req.body;
  console.log(`Creating signatures: name=${name}, color=${color}`);

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignature(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  // Palauta kuvat suoraan ilman tallennusta
  res.json({ images: signatureImages });
});

// Allekirjoitusten hakeminen
app.get("/api/get-signatures", (req, res) => {
  const sessionId = req.query.sessionId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  console.log(`Getting signatures for session: ${sessionId}`);

  if (signatures.has(sessionId)) {
    console.log(`Found signatures for session: ${sessionId}`);
    return res.json(signatures.get(sessionId));
  }

  console.log(`No signatures found for session: ${sessionId}`);
  return res.status(404).json({ error: "No signatures found" });
});

// Allekirjoitusten lataus
app.get("/api/download-signatures", (req, res) => {
  const sessionId = req.query.sessionId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  const hasSignatures = signatures.has(sessionId);
  const hasPaid = paidSessions.has(sessionId);

  console.log(
    `Downloading for session: ${sessionId}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
  );

  if (!hasSignatures || !hasPaid) {
    return res
      .status(403)
      .json({ error: "No permission to download signatures" });
  }

  const userSignatures = signatures.get(sessionId);

  // Luo ZIP-tiedosto
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=signatures-${Date.now()}.zip`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  // Käsittele virheet
  archive.on("error", function (err) {
    console.error("Virhe ZIP-tiedoston luonnissa:", err);
    res.status(500).send({ error: "Virhe tiedoston luonnissa" });
  });

  archive.pipe(res);

  // Lisää kuvat ilman vesileimaa
  signatureFonts.forEach((fontStyle, index) => {
    console.log(
      `Creating signature ${index + 1} with color: ${userSignatures.color}`
    );

    const signatureImage = createSignatureWithoutWatermark(
      userSignatures.name,
      fontStyle,
      userSignatures.color // Käytä tallennettua väriä
    );

    const imgBuffer = Buffer.from(
      signatureImage.replace(/^data:image\/png;base64,/, ""),
      "base64"
    );

    archive.append(imgBuffer, { name: `signature-${index + 1}.png` });
  });

  // Lisää README-tiedosto
  const readme = `Allekirjoitukset luotu: ${new Date().toLocaleString("fi-FI")}
Nimi: ${userSignatures.name}
Tiedostoja: ${signatureFonts.length} kpl

Kiitos että käytit palveluamme!`;

  archive.append(readme, { name: "README.txt" });

  archive.finalize();

  console.log(`Signatures downloaded successfully for session: ${sessionId}`);
});

// Allekirjoitusten palautus
app.post("/api/restore-signatures", (req, res) => {
  const { name, images, sessionId, color } = req.body;

  if (!name || !images || !Array.isArray(images) || !sessionId) {
    return res.status(400).json({ error: "Virheellinen pyyntö" });
  }

  console.log(`Restoring signatures for session: ${sessionId}, name: ${name}`);

  signatures.set(sessionId, {
    name,
    images,
    color,
    createdAt: new Date().toISOString(),
  });

  console.log("All stored signatures:");
  signatures.forEach((value, key) => {
    console.log(
      `Session: ${key}, Name: ${value.name}, Images: ${value.images.length}`
    );
  });

  res.json({ success: true });
});

// Lisätään uusi reitti maksun tarkistukseen
app.get("/api/check-payment/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log(`Checking payment status for sessionId: ${sessionId}`);

    // Tarkista ensin, onko käyttäjä jo merkitty maksaneeksi
    if (paidSessions.has(sessionId)) {
      console.log(`Session ${sessionId} is already marked as paid`);
      return res.json({ success: true, status: "paid" });
    }

    // Jos ei löydy paikallisesti, tarkista Stripe API:sta
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      console.log(
        `Payment confirmed by Stripe API for sessionId: ${sessionId}`
      );

      // Merkitse sessio maksetuksi
      paidSessions.add(sessionId);
      console.log(`Session ${sessionId} marked as paid through Stripe API`);

      return res.json({ success: true, status: "paid" });
    }

    return res.json({ success: true, status: session.payment_status });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res
      .status(500)
      .json({ success: false, error: "Error checking payment status" });
  }
});

// Reset user data
app.post("/api/reset-user-data", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res
      .status(400)
      .json({ success: false, message: "Session ID puuttuu." });
  }

  // Poista tiedot serverin Mapista ja Setistä
  if (signatures.has(sessionId)) {
    signatures.delete(sessionId);
  }

  if (paidSessions.has(sessionId)) {
    paidSessions.delete(sessionId);
  }

  console.log(`Deleted data for session: ${sessionId}`);
  res.json({ success: true, message: "User data deleted." });
});
// Karusellin allekirjoitusten luonti
app.post("/api/create-signature-for-carousel", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const fontStyle = signatureFonts.find(
    (font) => font.name.toLowerCase() === "omafontti3"
  );

  if (!fontStyle) {
    return res.status(400).json({ error: "Fonttia ei löytynyt" });
  }

  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = fontStyle.font;
  ctx.fillStyle = "blue";
  ctx.textAlign = "center";

  const textMetrics = ctx.measureText(name);
  const textHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  ctx.fillText(name, canvas.width / 2, centerY);

  const signatureImage = canvas.toDataURL("image/png");

  console.log(
    `Created carousel signature for "${name}" with font ${fontStyle.name} (${fontStyle.font})`
  );

  res.json({ image: signatureImage });
});

// Allekirjoitusten luonti ilman vesileimaa
app.post("/api/create-clean-signatures", (req, res) => {
  const { name, color } = req.body;
  console.log(`Creating clean signatures: name=${name}, color=${color}`);

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    // Käytä samaa funktiota mutta ilman vesileimoja
    const signatureImage = createSignatureWithoutWatermark(
      name,
      fontStyle,
      color
    );
    signatureImages.push(signatureImage);
  }

  // Palauta puhtaat kuvat
  res.json({ images: signatureImages });
});

// Webhook-käsittelijä Stripe-maksun vahvistamiseen
app.post("/api/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Käytä session ID:tä IP-osoitteen sijaan
    const sessionId = session.metadata.sessionId;

    if (sessionId) {
      console.log(`Payment successful for session ID: ${sessionId}`);
      paidSessions.add(sessionId);
    }
  }

  res.json({ received: true });
});

// Muuta IP-osoitteen hakeminen session ID:n generoimiseksi
app.get("/api/get-session-id", (req, res) => {
  // Generoi satunnainen session ID
  const sessionId = generateSessionId();
  console.log("Generated new session ID:", sessionId);
  res.send(sessionId);
});

// Apufunktio session ID:n generoimiseen
function generateSessionId() {
  // Generoi 32 merkkiä pitkä satunnainen merkkijono
  return Array(32)
    .fill(0)
    .map(() => Math.random().toString(36).charAt(2))
    .join("");
}

// Muokataan checkout-session luominen käyttämään Payment Linkkiä
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { name } = req.body;
    const sessionId = req.body.sessionId || "unknown";

    console.log(
      `Creating checkout session for name: ${name}, sessionId: ${sessionId}`
    );

    // Tarkista onko Payment Link määritetty
    const paymentLink = process.env.STRIPE_PAYMENT_LINK;

    if (paymentLink) {
      // Käytä valmiiksi määritettyä Payment Linkkiä, jossa verot on konfiguroitu
      console.log(`Using predefined payment link: ${paymentLink}`);

      // Lisää asiakaskohtaiset tiedot URL-parametreina
      const customizedLink = `${paymentLink}?client_reference_id=${sessionId}&prefilled_email=${encodeURIComponent(
        req.body.email || ""
      )}&metadata[name]=${encodeURIComponent(
        name
      )}&metadata[sessionId]=${sessionId}`;

      console.log(`Redirecting to customized payment link: ${customizedLink}`);
      return res.json({ url: customizedLink });
    }

    // Vaihtoehtoinen tapa: luo Checkout Session dynaamisesti verojen kanssa
    console.log("No payment link defined, creating checkout session with tax");

    // Hae verotiedot Stripe API:sta (varmista että verot on määritetty Stripe-paneelissa)
    const taxRates = await stripe.taxRates.list({
      active: true,
      limit: 10,
    });

    // Käytä ensimmäistä aktiivista veroa, jos sellainen löytyy
    const taxRateIds = taxRates.data.length > 0 ? [taxRates.data[0].id] : [];

    // Luo Stripe checkout session verojen kanssa
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Signature Package",
              description: `Handwritten signatures for ${name}`,
            },
            unit_amount: 100, // 1€ in cents
            tax_behavior: "exclusive", // Vero lisätään hintaan
          },
          quantity: 1,
          tax_rates: taxRateIds, // Lisää verot
        },
      ],
      automatic_tax: {
        enabled: true, // Käytä automaattista verolaskentaa
      },
      mode: "payment",
      success_url: `${req.headers.origin}?success=true`,
      cancel_url: `${req.headers.origin}?canceled=true`,
      metadata: {
        name: name,
        sessionId: sessionId,
      },
    });

    console.log(
      `Checkout session created: ${session.id}, redirecting to: ${session.url}`
    );
    res.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Muuta sähköpostin lähetys käyttämään Gmail-palvelinta ja ZIP-tiedostoa
app.post("/api/send-email", async (req, res) => {
  try {
    const { email, sessionId, signatures: clientSignatures } = req.body;

    // Käytä session ID:tä IP-osoitteen sijaan
    console.log(`Sending email to ${email} for session ${sessionId}`);

    // Tarkista onko käyttäjällä allekirjoituksia
    const hasSignatures = signatures.has(sessionId);

    console.log(`Session ${sessionId} - hasSignatures: ${hasSignatures}`);

    // Jos palvelimella ei ole allekirjoituksia, mutta client lähetti ne, tallenna ne
    if (
      !hasSignatures &&
      clientSignatures &&
      clientSignatures.name &&
      clientSignatures.images
    ) {
      console.log(`Storing signatures from client for session ${sessionId}`);
      signatures.set(sessionId, {
        name: clientSignatures.name,
        images: clientSignatures.images,
        color: clientSignatures.color || "black",
        createdAt: new Date().toISOString(),
      });
    }

    // Tarkista uudelleen allekirjoitusten olemassaolo
    const userSignatures = signatures.get(sessionId) || clientSignatures;

    if (!userSignatures) {
      console.log(`No signatures found for session ${sessionId}`);
      return res.status(403).json({
        success: false,
        error: "No signatures found",
      });
    }

    // Luo puhtaat allekirjoitukset ilman vesileimaa
    const cleanSignatures = [];
    for (const fontStyle of signatureFonts) {
      const signatureImage = createSignatureWithoutWatermark(
        userSignatures.name,
        fontStyle,
        userSignatures.color || "black"
      );
      cleanSignatures.push(signatureImage);
    }

    console.log(`Created ${cleanSignatures.length} clean signatures for email`);

    try {
      // Luo ZIP-tiedosto muistiin
      const archive = archiver("zip", {
        zlib: { level: 9 }, // Maksimipakkaus
      });

      // Luo puskuri ZIP-tiedostolle
      const zipBuffer = [];
      archive.on("data", (data) => {
        zipBuffer.push(data);
      });

      // Kun ZIP on valmis, lähetä sähköposti
      archive.on("end", async () => {
        try {
          const zipContent = Buffer.concat(zipBuffer);

          // Lähetä sähköposti Nodemailer + Gmail:llä yksinkertaisemmalla muotoilulla
          const info = await transporter.sendMail({
            from: '"Signature Generator" <support@handwrittensignaturegenerator.com>',
            to: email,
            subject: `Your Signatures for ${userSignatures.name}`,
            text: `Hello,

Here are your signatures for ${userSignatures.name}.

The signatures are attached to this email as a ZIP file. Please extract the ZIP file to access your signatures.

Thank you for using our service!

--
This email was sent from Signature Generator.`,
            html: `
              <div style="font-family: sans-serif;">
                <p>Hello,</p>
                <p>Here are your signatures for <b>${userSignatures.name}</b>.</p>
                <p>The signatures are attached to this email as a ZIP file. Please extract the ZIP file to access your signatures.</p>
                <p>Thank you for using our service!</p>
                <p>--<br>This email was sent from Signature Generator.</p>
              </div>
            `,
            attachments: [
              {
                filename: `signatures-${userSignatures.name.replace(
                  /\s+/g,
                  "-"
                )}.zip`,
                content: zipContent,
                contentType: "application/zip",
              },
            ],
          });

          console.log("Email sent successfully:", info.messageId);
          res.json({ success: true });
        } catch (emailError) {
          console.error("SMTP Error:", emailError);
          return res.status(500).json({
            success: false,
            error: "Failed to send email via SMTP",
            details: emailError.message,
          });
        }
      });

      // Lisää kuvat ZIP-tiedostoon
      cleanSignatures.forEach((image, index) => {
        const imgBuffer = Buffer.from(
          image.replace(/^data:image\/png;base64,/, ""),
          "base64"
        );
        archive.append(imgBuffer, { name: `signature-${index + 1}.png` });
      });

      // Viimeistele ZIP-tiedosto
      archive.finalize();
    } catch (emailError) {
      console.error("Error creating ZIP or sending email:", emailError);
      return res.status(500).json({
        success: false,
        error: "Failed to create ZIP or send email",
        details: emailError.message,
      });
    }
  } catch (error) {
    console.error("Error in email handler:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process email request",
      details: error.message,
    });
  }
});
export default app;
