//1. TUODAAN TARVITTAVAT MODUULIT
import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas, registerFont } from "canvas";
import "dotenv/config";
import crypto from "crypto";

//2. ALUSTETAAN MUUTTUJAT
const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const app = express();
const signatures = new Map();
const paidSessions = new Set();
const sessions = new Map();

//3. MIDDLEWARE MÄÄRITTELYT
app.use(cors());
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

//4. IP-OSOITTEEN JA SESSION ID:N KÄSITTELYFUNKTIOT
function getClientIp(req) {
  return req.headers["x-forwarded-for"] || req.connection.remoteAddress;
}

function getClientIpFormatted(req) {
  const ip = getClientIp(req);
  const formattedIp = ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();
  return formattedIp.replace(/^::ffff:/, "");
}

function generateSessionId() {
  return crypto.randomBytes(16).toString("hex");
}

function getOrCreateSessionId(req) {
  const clientIp = getClientIpFormatted(req);

  if (sessions.has(clientIp)) {
    return sessions.get(clientIp);
  }

  const sessionId = generateSessionId();
  sessions.set(clientIp, sessionId);
  console.log(`Created new session ID ${sessionId} for IP ${clientIp}`);

  return sessionId;
}

//5. FONTTIEN REKISTERÖINTI JA HALLINTA
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
            fontName.toLowerCase() === "omafontti1" ||
            fontName.toLowerCase() === "omafontti3"
              ? `100px '${fontFamily}'`
              : `40px '${fontFamily}'`,
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
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = fontStyle.font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";

  const textMetrics = ctx.measureText(name);
  const actualHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  ctx.fillText(name, canvas.width / 2, centerY);

  return canvas.toDataURL("image/png");
}

function createSignature(name, fontStyle, color = "black") {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  ctx.font = fontStyle.font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";

  const textMetrics = ctx.measureText(name);
  const actualHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  ctx.fillText(name, canvas.width / 2, centerY);

  return canvas.toDataURL("image/png");
}

//7. API REITIT

app.get("/api/get-session-id", (req, res) => {
  const sessionId = getOrCreateSessionId(req);
  res.send(sessionId);
});

app.get("/api/get-client-ip", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  const sessionId = getOrCreateSessionId(req);
  res.json({ clientIp, sessionId });
});

app.get("/api/check-signatures", (req, res) => {
  const sessionId = req.query.sessionId || getOrCreateSessionId(req);
  const hasSignatures = signatures.has(sessionId);
  const hasPaid = paidSessions.has(sessionId);

  console.log(
    `Checking status for session: ${sessionId}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
  );

  res.json({
    hasSignatures,
    hasPaid,
    canDownload: hasSignatures && hasPaid,
    sessionId,
  });
});

app.post("/api/create-signatures", (req, res) => {
  const { name, color, sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  console.log(
    `Creating signatures: name=${name}, color=${color}, sessionId=${userSessionId}`
  );

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignature(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  signatures.set(userSessionId, {
    name,
    color,
    images: signatureImages,
    createdAt: new Date().toISOString(),
  });

  console.log(`Saved signatures for session ${userSessionId}`);
  console.log(`Current signatures map size: ${signatures.size}`);

  res.json({
    images: signatureImages,
    sessionId: userSessionId,
  });
});

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

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=signatures-${Date.now()}.zip`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", function (err) {
    console.error("Virhe ZIP-tiedoston luonnissa:", err);
    res.status(500).send({ error: "Virhe tiedoston luonnissa" });
  });

  archive.pipe(res);

  signatureFonts.forEach((fontStyle, index) => {
    console.log(
      `Creating signature ${index + 1} with color: ${userSignatures.color}`
    );

    const signatureImage = createSignatureWithoutWatermark(
      userSignatures.name,
      fontStyle,
      userSignatures.color
    );

    const imgBuffer = Buffer.from(
      signatureImage.replace(/^data:image\/png;base64,/, ""),
      "base64"
    );

    archive.append(imgBuffer, { name: `signature-${index + 1}.png` });
  });

  const readme = `Allekirjoitukset luotu: ${new Date().toLocaleString("fi-FI")}
Nimi: ${userSignatures.name}
Tiedostoja: ${signatureFonts.length} kpl

Kiitos että käytit palveluamme!`;

  archive.append(readme, { name: "README.txt" });

  archive.finalize();

  console.log(`Signatures downloaded successfully for session: ${sessionId}`);
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { name, sessionId } = req.body;

    if (!name) {
      console.error("Name missing from checkout request");
      return res.status(400).json({ error: "Name is required" });
    }

    if (!sessionId) {
      console.error("SessionId missing from checkout request");
      return res.status(400).json({ error: "SessionId is required" });
    }

    const userSessionId = sessionId;

    console.log(
      `Creating checkout session for ${name}, session ID: ${userSessionId}`
    );

    // Tarkista onko allekirjoituksia olemassa
    if (!signatures.has(userSessionId)) {
      console.error(`No signatures found for session: ${userSessionId}`);
      return res
        .status(400)
        .json({ error: "No signatures found for this session" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Handwritten Signatures",
              description: `Handwritten signatures for ${name}`,
            },
            unit_amount: 500, // 5€ sentteinä
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.origin}?success=true&sessionId=${userSessionId}`,
      cancel_url: `${req.headers.origin}?canceled=true&sessionId=${userSessionId}`,
      metadata: {
        sessionId: userSessionId,
      },
    });

    console.log(`Checkout session created: ${session.id}, URL: ${session.url}`);
    res.json({ url: session.url, sessionId: userSessionId });
  } catch (error) {
    console.error("Virhe checkout-session luonnissa:", error);
    res.status(500).json({
      error: "Virhe checkout-session luonnissa",
      details: error.message,
    });
  }
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { email, sessionId } = req.body;
    const userSessionId = sessionId || getOrCreateSessionId(req);

    if (!email) {
      return res.status(400).json({
        error: "Sähköpostiosoite puuttuu",
      });
    }

    const hasSignatures = signatures.has(userSessionId);
    const hasPaid = paidSessions.has(userSessionId);

    if (!hasSignatures || !hasPaid) {
      return res.status(403).json({
        error: "Ei oikeutta lähettää allekirjoituksia sähköpostilla",
      });
    }

    res.json({
      success: true,
      message: "Sähköposti lähetetty onnistuneesti",
      sessionId: userSessionId,
    });
  } catch (error) {
    console.error("Virhe sähköpostin lähetyksessä:", error);
    res.status(500).json({ error: "Virhe sähköpostin lähetyksessä" });
  }
});

app.get("/api/debug", (req, res) => {
  const sessionId = req.query.sessionId || getOrCreateSessionId(req);
  res.json({
    sessionId,
    hasSignatures: signatures.has(sessionId),
    hasPaid: paidSessions.has(sessionId),
    signaturesSize: signatures.size,
    paidSessionsSize: paidSessions.size,
  });
});

app.post("/api/create-clean-signatures", (req, res) => {
  const { name, color, sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  console.log(
    `Creating clean signatures: name=${name}, color=${color}, sessionId=${userSessionId}`
  );

  if (!paidSessions.has(userSessionId)) {
    console.log(`Payment required for session: ${userSessionId}`);
    return res.status(402).json({ error: "Payment required" });
  }

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignatureWithoutWatermark(
      name,
      fontStyle,
      color
    );
    signatureImages.push(signatureImage);
  }

  res.json({
    images: signatureImages,
    sessionId: userSessionId,
  });
});

app.post("/api/mark-as-paid", (req, res) => {
  const { sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  if (!userSessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  paidSessions.add(userSessionId);
  console.log(`Session ${userSessionId} marked as paid`);

  return res.json({
    success: true,
    sessionId: userSessionId,
  });
});

app.post("/api/check-payment-status", (req, res) => {
  const { sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  if (!userSessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  const hasPaid = paidSessions.has(userSessionId);
  console.log(`Payment status for session ${userSessionId}: ${hasPaid}`);

  return res.json({
    hasPaid,
    sessionId: userSessionId,
  });
});

app.post("/api/reset-user-data", (req, res) => {
  const { sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  if (!userSessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  if (signatures.has(userSessionId)) {
    signatures.delete(userSessionId);
  }

  if (paidSessions.has(userSessionId)) {
    paidSessions.delete(userSessionId);
  }

  console.log(`Deleted data for session: ${userSessionId}`);
  res.json({
    success: true,
    message: "User data deleted.",
    sessionId: userSessionId,
  });
});

app.post("/api/restore-signatures", (req, res) => {
  const { name, images, color, sessionId } = req.body;
  const userSessionId = sessionId || getOrCreateSessionId(req);

  if (!name || !images || !Array.isArray(images)) {
    return res.status(400).json({ error: "Virheellinen pyyntö" });
  }

  console.log(
    `Restoring signatures for session: ${userSessionId}, name: ${name}`
  );

  signatures.set(userSessionId, {
    name,
    color,
    images,
    createdAt: new Date().toISOString(),
  });

  console.log(`Signatures restored for session ${userSessionId}`);
  console.log(`Current signatures map size: ${signatures.size}`);

  res.json({
    success: true,
    sessionId: userSessionId,
  });
});

export default app;
