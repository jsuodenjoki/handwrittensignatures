import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas, registerFont } from "canvas";
import "dotenv/config";

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);

const app = express();
const signatures = new Map();
const paidIPs = new Set();

app.use(cors());
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "50mb" }));

// Tarkistetaan IP-osoitteen käsittely
function getClientIp(req) {
  // Tarkistetaan kaikki mahdolliset IP-osoitteen lähteet
  const ip =
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket?.remoteAddress;

  console.log("Alkuperäinen IP:", ip);

  // Normalisoidaan IP-osoite
  const normalizedIp = ip
    ? ip.includes(",")
      ? ip.split(",")[0].trim()
      : ip.trim()
    : "unknown-ip";

  console.log("Normalisoitu IP:", normalizedIp);

  return normalizedIp;
}

// Korvataan getClientIpFormatted-funktio
function getClientIpFormatted(req) {
  return getClientIp(req);
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

  res.json({
    hasSignatures,
    hasPaid,
    canDownload: hasSignatures && hasPaid,
  });
});

// Tarkista saatavilla olevat fontit
const fontsDir = path.join(__dirname, "../public/fonts");
// Alusta tyhjä fonttilistaus
const signatureFonts = [];

try {
  // Tarkista onko fonts-kansio olemassa
  if (fs.existsSync(fontsDir)) {
    const fontFiles = fs.readdirSync(fontsDir);
    console.log("Saatavilla olevat fontit:", fontFiles);

    // Rekisteröi kaikki löydetyt fontit
    fontFiles.forEach((fontFile) => {
      if (fontFile.endsWith(".ttf")) {
        const fontName = fontFile.replace(".ttf", "").replace(/[-_]/g, " ");
        const fontFamily = fontName.replace(/\s+/g, "");
        console.log(`Rekisteröidään fontti: ${fontFile} nimellä ${fontFamily}`);
        registerFont(path.join(fontsDir, fontFile), { family: fontFamily });

        // Lisää fontti listaan
        // Lisää fontti listaan
        signatureFonts.push({
          name: fontName,
          font:
            fontName === "OmaFontti1" || fontName === "OmaFontti3"
              ? `60px '${fontFamily}'`
              : `40px '${fontFamily}'`, // Muuta fonttikoko ehtojen mukaan
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
function createSignature(name, fontStyle) {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  // Aseta tausta
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Aseta fontti
  ctx.font = fontStyle.font;
  ctx.fillStyle = "black";
  ctx.textAlign = "center";

  // Mittaa tekstin korkeus
  const textMetrics = ctx.measureText(name);
  const actualHeight =
    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent;

  // Siirrä y-keskitystä riippuen fontin korkeudesta
  const centerY =
    canvas.height / 2 +
    (textMetrics.actualBoundingBoxAscent -
      textMetrics.actualBoundingBoxDescent) /
      2;

  // Piirrä teksti
  ctx.fillText(name, canvas.width / 2, centerY);

  return canvas.toDataURL("image/png");
}

// API-reitti allekirjoitusten luomiseen
app.post("/api/create-signatures", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  // Luo allekirjoitus jokaisella fontilla
  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignature(name, fontStyle);
    signatureImages.push(signatureImage);
  }

  // Tallenna allekirjoitukset käyttäjälle
  const clientIp = getClientIpFormatted(req);
  console.log(
    `Tallennetaan allekirjoitukset IP:lle ${clientIp}, nimi: ${name}`
  );

  signatures.set(clientIp, {
    name,
    images: signatureImages,
    createdAt: new Date().toISOString(),
  });

  // Loki kaikista tallennetuista allekirjoituksista
  console.log("Kaikki tallennetut allekirjoitukset:");
  signatures.forEach((value, key) => {
    console.log(
      `IP: ${key}, Nimi: ${value.name}, Kuvia: ${value.images.length}`
    );
  });

  res.json({ images: signatureImages });
});

// Hae tallennetut allekirjoitukset
app.get("/api/get-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  console.log(`Haetaan allekirjoitukset IP:lle ${clientIp}`);

  if (signatures.has(clientIp)) {
    const data = signatures.get(clientIp);
    console.log(
      `Löydettiin allekirjoitukset: Nimi: ${data.name}, Kuvia: ${data.images.length}`
    );
    res.json(signatures.get(clientIp));
  } else {
    console.log(`Ei löydetty allekirjoituksia IP:lle ${clientIp}`);
    res.status(404).json({ error: "Allekirjoituksia ei löytynyt" });
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

  // Luo ZIP-tiedosto
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=signatures-${Date.now()}.zip`
  );

  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  archive.pipe(res);

  // Lisää kuvat ZIP-tiedostoon
  userSignatures.images.forEach((imgData, index) => {
    const imgBuffer = Buffer.from(
      imgData.replace(/^data:image\/png;base64,/, ""),
      "base64"
    );
    archive.append(imgBuffer, { name: `signature-${index + 1}.png` });
  });

  archive.finalize();

  // Poista tallennetut allekirjoitukset ja maksutila latauksen jälkeen
  signatures.delete(clientIp);
  paidIPs.delete(clientIp);
});

// Luo Stripe-maksu
app.post("/api/create-payment", async (req, res) => {
  try {
    const clientIp = getClientIpFormatted(req);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Allekirjoitusten luonti",
            },
            unit_amount: 500, // 5 EUR
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

    res.json({ url: session.url });
  } catch (error) {
    console.error("Virhe maksun luonnissa:", error);
    res.status(500).json({ error: "Virhe maksun käsittelyssä" });
  }
});

// Stripe webhook maksun käsittelyyn
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    try {
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

        if (signatures.has(clientIp)) {
          paidIPs.add(clientIp);
          console.log("✅ Maksu merkitty onnistuneeksi IP:lle:", clientIp);
        } else {
          console.log(
            "⚠️ Varoitus: Allekirjoituksia ei löytynyt IP:lle:",
            clientIp
          );
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("Webhook-virhe:", err.message);
      return res.status(400).send(`Webhook-virhe: ${err.message}`);
    }
  }
);

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

  // Käytä vain ensimmäistä fonttia, mutta varmista että fonttikoko on riittävän suuri
  const fontStyle = {
    name: signatureFonts[0].name,
    font: signatureFonts[0].font.replace(/\d+px/, "60px"), // Varmista että fonttikoko on 60px
  };

  // Luo allekirjoitus erikseen karusellille
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  // Aseta tausta
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Aseta fontti
  ctx.font = fontStyle.font;
  ctx.fillStyle = "black";
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

  console.log(`Palautetaan allekirjoitukset IP:lle ${clientIp}, nimi: ${name}`);

  // Tallenna allekirjoitukset käyttäjälle
  signatures.set(clientIp, {
    name,
    images,
    createdAt: new Date().toISOString(),
  });

  // Loki kaikista tallennetuista allekirjoituksista
  console.log("Kaikki tallennetut allekirjoitukset:");
  signatures.forEach((value, key) => {
    console.log(
      `IP: ${key}, Nimi: ${value.name}, Kuvia: ${value.images.length}`
    );
  });

  res.json({ success: true });
});

export default app;
