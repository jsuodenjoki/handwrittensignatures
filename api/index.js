import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas } from "canvas";
import "dotenv/config";

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);

const app = express();
const signatures = new Map();
const paidIPs = new Set();

app.use(cors());
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "50mb" }));

// IP-osoitteen normalisointi
function getClientIp(req) {
  return req.headers["x-forwarded-for"] || req.connection.remoteAddress;
}

function getClientIpFormatted(req) {
  const ip = getClientIp(req);
  return ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();
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

// Allekirjoitusten luonti ja tallennus
app.post("/api/generate-signatures", (req, res) => {
  try {
    const { name, signatureImages } = req.body;
    const clientIp = getClientIpFormatted(req);

    if (!name || !signatureImages || !Array.isArray(signatureImages)) {
      return res.status(400).json({ error: "Virheellinen pyyntö" });
    }

    // Tallenna allekirjoitukset IP-osoitteen perusteella
    signatures.set(clientIp, {
      name,
      images: signatureImages,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Allekirjoitukset luotu onnistuneesti",
    });
  } catch (error) {
    console.error("Virhe allekirjoitusten luonnissa:", error);
    res.status(500).json({ error: "Virhe allekirjoitusten käsittelyssä" });
  }
});

// Hae tallennetut allekirjoitukset
app.get("/api/get-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);

  if (signatures.has(clientIp)) {
    res.json(signatures.get(clientIp));
  } else {
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

export default app;
