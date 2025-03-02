import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas, registerFont } from "canvas";
import "dotenv/config";
import JSZip from "jszip";

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const app = express();
const signatures = new Map();
const paidIPs = new Set();

// 1. Määritä middlewaret oikeassa järjestyksessä
app.use(cors());

// 2. Määritä webhook middleware ENNEN muita middlewareja
const webhookMiddleware = express.raw({ type: "application/json" });

// 3. Määritä reittispesifinen middleware webhookille
app.post("/api/webhook", webhookMiddleware, async (req, res) => {
  const sig = req.headers["stripe-signature"];

  try {
    // Varmista että req.body on Buffer
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("Webhook-tapahtuma vastaanotettu:", event.type);

    if (
      [
        "checkout.session.completed",
        "payment_intent.succeeded",
        "charge.succeeded",
      ].includes(event.type)
    ) {
      const session = event.data.object;
      const clientIp = session.metadata?.clientIp?.trim() || "UNKNOWN";

      console.log("Webhook metadata:", session.metadata);
      console.log(
        "Kaikki tallennetut allekirjoitukset:",
        Array.from(signatures.keys())
      );
      console.log("Etsitään IP-osoitetta:", clientIp);

      if (signatures.has(clientIp)) {
        paidIPs.add(clientIp);
        console.log("✅ Maksu merkitty onnistuneeksi IP:lle:", clientIp);
      } else {
        // Yritä löytää samankaltainen IP-osoite
        let found = false;
        for (const ip of signatures.keys()) {
          if (
            ip.includes(clientIp) ||
            clientIp.includes(ip) ||
            ip.split(".").slice(0, 3).join(".") ===
              clientIp.split(".").slice(0, 3).join(".")
          ) {
            paidIPs.add(ip);
            console.log(
              "✅ Maksu merkitty onnistuneeksi samankaltaiselle IP:lle:",
              ip
            );
            found = true;
            break;
          }
        }

        if (!found) {
          console.log(
            "⚠️ Varoitus: Allekirjoituksia ei löytynyt IP:lle:",
            clientIp
          );
          console.log("Tallennetut IP:t:", Array.from(signatures.keys()));
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook-virhe:", err.message);
    return res.status(400).send(`Webhook-virhe: ${err.message}`);
  }
});

// 4. Määritä JSON parser muille reiteille
app.use(express.json());

// 5. Paranna IP-osoitteen tunnistusta
function getClientIp(req) {
  // Tarkista kaikki mahdolliset IP-lähteet
  return (
    req.headers["cf-connecting-ip"] || // Cloudflare
    req.headers["x-real-ip"] || // Nginx
    req.headers["x-client-ip"] || // General
    req.headers["x-forwarded-for"]?.split(",")[0] || // Proxy
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getClientIpFormatted(req) {
  const ip = getClientIp(req);
  console.log("Alkuperäinen IP:", ip);
  const formattedIp = ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();
  console.log("Muotoiltu IP:", formattedIp);
  return formattedIp;
}

// Palauttaa käyttäjän IP-osoitteen
app.get("/api/get-client-ip", (req, res) => {
  res.send(getClientIpFormatted(req));
});

// Tarkista allekirjoituksen tila
app.get("/api/check-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  const hasSignatures = signatures.has(clientIp);
  const hasPaid = paidIPs.has(clientIp);

  let signatureCount = 0;
  if (hasSignatures) {
    const data = signatures.get(clientIp);
    signatureCount = data.previewImages.length;
  }

  res.json({
    hasSignatures,
    hasPaid,
    canDownload: hasSignatures && hasPaid,
    signatureCount,
  });
});

// Rekisteröi Poppins-fontti vesileimoja varten
registerFont(path.join(__dirname, "../public/fonts2/poppins.ttf"), {
  family: "Poppins",
});

// Rekisteröi muut fontit allekirjoituksia varten
const fontsDir = path.join(__dirname, "../public/fonts");
const signatureFonts = [];

try {
  if (fs.existsSync(fontsDir)) {
    const fontFiles = fs.readdirSync(fontsDir);
    console.log("Saatavilla olevat fontit:", fontFiles);

    fontFiles.forEach((fontFile) => {
      if (fontFile.endsWith(".ttf")) {
        const fontName = fontFile.replace(".ttf", "").replace(/[-_]/g, " ");
        const fontFamily = fontName.replace(/\s+/g, "");
        console.log(`Rekisteröidään fontti: ${fontFile} nimellä ${fontFamily}`);
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

  // Jos ei löytynyt fontteja, käytä oletusfontteja
  if (signatureFonts.length === 0) {
    console.log("Ei löytynyt fontteja, käytetään oletusfontteja");

    // Käytä järjestelmän oletusfontteja
    signatureFonts.push(
      { name: "Arial", font: "40px Arial, sans-serif" },
      { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
      { name: "Courier New", font: "40px 'Courier New', monospace" }
    );
  }
} catch (error) {
  console.error("Virhe fonttien lataamisessa:", error);

  // Virhetilanteessa käytä oletusfontteja
  signatureFonts.push(
    { name: "Arial", font: "40px Arial, sans-serif" },
    { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
    { name: "Courier New", font: "40px 'Courier New', monospace" }
  );
}

// Luo allekirjoitus
function createSignature(
  name,
  fontStyle,
  color = "black",
  withWatermark = true
) {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  // Aseta tausta
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (withWatermark) {
    // LISÄTÄÄN WATERMARK-TEKSTIT
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
  }

  // Aseta fontti allekirjoitukselle
  ctx.font = fontStyle.font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";

  // Mittaa tekstin korkeus
  const textMetrics = ctx.measureText(name);
  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  // Piirrä allekirjoitus
  ctx.fillText(name, canvas.width / 2, centerY);

  return canvas.toDataURL("image/png");
}

// API-reitti allekirjoitusten luomiseen
app.post("/api/create-signatures", (req, res) => {
  const { name, color } = req.body;
  const clientIp = getClientIpFormatted(req);

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  // Luo molemmat versiot
  const previewImages = [];
  const downloadImages = [];

  for (const fontStyle of signatureFonts) {
    const previewImage = createSignature(name, fontStyle, color, true);
    const downloadImage = createSignature(name, fontStyle, color, false);
    previewImages.push(previewImage);
    downloadImages.push(downloadImage);
  }

  // Tallenna IP:n perusteella
  signatures.set(clientIp, {
    name,
    previewImages,
    downloadImages,
    createdAt: new Date().toISOString(),
  });

  console.log(`Tallennettu allekirjoitukset IP:lle ${clientIp}`);
  console.log(
    `Preview-kuvia: ${previewImages.length}, Download-kuvia: ${downloadImages.length}`
  );

  // Palauta vain preview-kuvat
  res.json({
    message: `${previewImages.length} allekirjoitusta luotu!`,
    images: previewImages,
    needsPayment: true,
  });
});

// Hae tallennetut allekirjoitukset
app.get("/api/get-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  console.log(`Haetaan allekirjoitukset IP:lle ${clientIp}`);

  if (signatures.has(clientIp)) {
    const data = signatures.get(clientIp);
    console.log(
      `Löydettiin allekirjoitukset: Nimi: ${data.name}, Preview-kuvia: ${data.previewImages.length}, Download-kuvia: ${data.downloadImages.length}`
    );

    res.json({
      name: data.name,
      images: data.previewImages,
      createdAt: data.createdAt,
    });
  } else {
    console.log(`Ei löydetty allekirjoituksia IP:lle ${clientIp}`);
    res.json({
      name: "",
      images: [],
      createdAt: null,
    });
  }
});

// Lataa allekirjoitukset ZIP-tiedostona
app.get("/api/download-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);

  if (!signatures.has(clientIp) || !paidIPs.has(clientIp)) {
    return res
      .status(403)
      .json({ error: "Ei oikeutta ladata allekirjoituksia" });
  }

  const userSignatures = signatures.get(clientIp);

  try {
    const zip = new JSZip();

    userSignatures.downloadImages.forEach((imgData, index) => {
      const imgBuffer = Buffer.from(
        imgData.replace(/^data:image\/png;base64,/, ""),
        "base64"
      );
      zip.file(`signature-${index + 1}.png`, imgBuffer);
    });

    zip.generateAsync({ type: "nodebuffer" }).then((content) => {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=signatures-${Date.now()}.zip`
      );
      res.send(content);

      // Poista allekirjoitukset 3 minuutin kuluttua
      setTimeout(() => {
        signatures.delete(clientIp);
        paidIPs.delete(clientIp);
        console.log(`Tyhjennetty allekirjoitukset IP:lle ${clientIp}`);
      }, 180000);
    });
  } catch (error) {
    console.error("Virhe ZIP-tiedoston luonnissa:", error);
    res.status(500).json({ error: "Virhe allekirjoitusten lataamisessa" });
  }
});

// 6. Paranna Stripe-maksun luontia
app.post("/api/create-payment", async (req, res) => {
  try {
    const clientIp = getClientIpFormatted(req);
    console.log("Luodaan maksu IP:lle:", clientIp);

    if (!signatures.has(clientIp)) {
      return res
        .status(400)
        .json({ error: "Ei allekirjoituksia tälle IP:lle" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Allekirjoitusten luonti",
            },
            unit_amount: 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/index.html?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/index.html?canceled=true`,
      metadata: {
        clientIp,
      },
    });

    console.log("Maksu luotu onnistuneesti, session ID:", session.id);
    res.json({ url: session.url });
  } catch (error) {
    console.error("Virhe maksun luonnissa:", error);
    res.status(500).json({ error: "Virhe maksun käsittelyssä" });
  }
});

// Lähetä allekirjoitukset sähköpostiin
app.post("/api/send-email", async (req, res) => {
  try {
    const { email } = req.body;
    const clientIp = getClientIpFormatted(req);

    if (!email || !signatures.has(clientIp) || !paidIPs.has(clientIp)) {
      return res.status(400).json({
        error: "Virheellinen pyyntö tai ei oikeutta lähettää sähköpostia",
      });
    }

    // Tässä voit toteuttaa sähköpostin lähetyksen
    // Esimerkiksi käyttäen nodemailer-kirjastoa

    res.json({ success: true, message: "Sähköposti lähetetty onnistuneesti" });
  } catch (error) {
    console.error("Virhe sähköpostin lähetyksessä:", error);
    res.status(500).json({ error: "Virhe sähköpostin lähetyksessä" });
  }
});

// Debug-endpoint
app.get("/api/debug", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  res.json({
    clientIp,
    hasSignatures: signatures.has(clientIp),
    hasPaid: paidIPs.has(clientIp),
    signaturesSize: signatures.size,
    paidIPsSize: paidIPs.size,
  });
});

// API-reitti karusellin allekirjoitusten luomiseen
app.post("/api/create-signature-for-carousel", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  // Etsi "OmaFontti3" fonttilistasta
  const fontStyle = signatureFonts.find(
    (font) => font.name.toLowerCase() === "omafontti3"
  );

  if (!fontStyle) {
    return res.status(400).json({ error: "Fonttia ei löytynyt" });
  }

  // Luo allekirjoitus erikseen karusellille
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  // Aseta tausta
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Aseta fontti
  ctx.font = fontStyle.font;
  ctx.fillStyle = "blue"; // Kuulakärkikynän väri
  ctx.textAlign = "center";

  // Mittaa tekstin todellinen korkeus
  const textMetrics = ctx.measureText(name);
  const textHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  // Lasketaan oikea y-keskiö ja säädetään tekstiä, jotta se on tasapainossa
  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  // Piirrä teksti täsmälleen keskelle canvasia
  ctx.fillText(name, canvas.width / 2, centerY);

  const signatureImage = canvas.toDataURL("image/png");

  console.log(
    `Luotu karusellin allekirjoitus nimelle "${name}" fontilla ${fontStyle.name} (${fontStyle.font})`
  );

  res.json({ image: signatureImage });
});

// API-reitti allekirjoitusten palauttamiseen
app.post("/api/restore-signatures", (req, res) => {
  const { name, images } = req.body;
  const clientIp = getClientIpFormatted(req);

  if (!name || !images || !Array.isArray(images)) {
    return res.status(400).json({ error: "Virheellinen pyyntö" });
  }

  // Tallenna vain previewImages, koska downloadImages luodaan vasta maksun jälkeen
  signatures.set(clientIp, {
    name,
    previewImages: images,
    downloadImages: [], // Tyhjä array aluksi
    createdAt: new Date().toISOString(),
  });

  console.log(
    `Palautettu allekirjoitukset IP:lle ${clientIp}, nimi: ${name}, kuvia: ${images.length}`
  );
  res.json({ success: true });
});

export default app;
