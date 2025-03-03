//1. TUODAAN TARVITTAVAT MODUULIT
import express from "express";
import cors from "cors";
import stripePackage from "stripe";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createCanvas, registerFont } from "canvas";
import "dotenv/config";

//2. ALUSTETAAN MUUTTUJAT
const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);
const app = express();
const signatures = new Map();
const paidIPs = new Set();

//3. MIDDLEWARE MÄÄRITTELYT
app.use(cors());
app.use("/api/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

//4. IP-OSOITTEEN KÄSITTELYFUNKTIOT
function getClientIp(req) {
  return req.headers["x-forwarded-for"] || req.connection.remoteAddress;
}

function getClientIpFormatted(req) {
  const ip = getClientIp(req);
  const formattedIp = ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();
  return formattedIp.replace(/^::ffff:/, "");
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

  if (signatureFonts.length === 0) {
    console.log("Ei löytynyt fontteja, käytetään oletusfontteja");
    signatureFonts.push(
      { name: "Arial", font: "40px Arial, sans-serif" },
      { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
      { name: "Courier New", font: "40px 'Courier New', monospace" }
    );
  }
} catch (error) {
  console.error("Virhe fonttien lataamisessa:", error);
  signatureFonts.push(
    { name: "Arial", font: "40px Arial, sans-serif" },
    { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
    { name: "Courier New", font: "40px 'Courier New', monospace" }
  );
}

//6. ALLEKIRJOITUSTEN LUONTIFUNKTIOT
function createSignatureWithoutWatermark(name, fontStyle, color) {
  console.log(
    `Luodaan allekirjoitus ilman vesileimaa: nimi=${name}, väri=${color}`
  );

  const canvas = createCanvas(800, 300);
  const ctx = canvas.getContext("2d");

  // Tyhjennä canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Aseta fontti ja väri
  ctx.font = fontStyle.font;
  ctx.fillStyle = color || "black"; // Käytä valittua väriä tai mustaa oletuksena

  console.log(`Käytetään väriä: ${ctx.fillStyle}`);

  // Piirrä allekirjoitus
  ctx.fillText(name, 50, 150);

  // Palauta base64-koodattu kuva
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

// IP-osoitteen hakureitti
app.get("/api/get-client-ip", (req, res) => {
  res.send(getClientIpFormatted(req));
});

// Allekirjoitusten tilan tarkistus
app.get("/api/check-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  const sessionId = req.query.session_id;

  console.log(
    `Tarkistetaan tila IP:lle ${clientIp}, session ID: ${
      sessionId || "ei saatavilla"
    }`
  );
  console.log("Kaikki maksetut session ID:t:", Array.from(paidIPs));

  const hasSignatures = signatures.has(clientIp);

  // Tarkistetaan maksu session ID:n perusteella, jos se on saatavilla
  let hasPaid = sessionId ? paidIPs.has(sessionId) : paidIPs.has(clientIp);

  console.log(
    `Suora tarkistus: hasPaid = ${hasPaid}, sessionId = ${sessionId}, paidIPs.has(sessionId) = ${paidIPs.has(
      sessionId
    )}`
  );

  if (!hasPaid && sessionId) {
    // Tarkistetaan osittaiset vastaavuudet session ID:lle
    for (const id of paidIPs) {
      console.log(
        `Verrataan session ID:tä ${sessionId} maksettuun ID:hen ${id}`
      );
      if (id.includes(sessionId) || sessionId.includes(id)) {
        hasPaid = true;
        console.log(
          `Session ID ${sessionId} vastaa maksettua session ID:tä ${id}`
        );
        // Lisätään tämä session ID myös maksettuihin
        paidIPs.add(sessionId);
        break;
      }
    }
  } else if (!hasPaid) {
    // Tarkistetaan osittaiset vastaavuudet IP:lle (vanha tapa)
    for (const ip of paidIPs) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        hasPaid = true;
        console.log(`IP ${clientIp} vastaa osittain maksettua IP:tä ${ip}`);
        // Lisätään tämä IP myös maksettuihin
        paidIPs.add(clientIp);
        break;
      }
    }
  }

  console.log(
    `Tarkistetaan tila IP:lle ${clientIp}, session ID: ${
      sessionId || "ei saatavilla"
    }: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
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
  console.log(`Luodaan allekirjoitukset: nimi=${name}, väri=${color}`);

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignature(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  const clientIp = getClientIpFormatted(req);
  console.log(
    `Tallennetaan allekirjoitukset IP:lle ${clientIp}, nimi: ${name}, väri: ${color}`
  );

  signatures.set(clientIp, {
    name,
    images: signatureImages,
    color: color,
    createdAt: new Date().toISOString(),
  });

  console.log("Kaikki tallennetut allekirjoitukset:");
  signatures.forEach((value, key) => {
    console.log(
      `IP: ${key}, Nimi: ${value.name}, Väri: ${value.color}, Kuvia: ${value.images.length}`
    );
  });

  res.json({ images: signatureImages });
});

// Allekirjoitusten hakeminen
app.get("/api/get-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  console.log(`Haetaan allekirjoituksia IP:lle ${clientIp}`);
  console.log(
    `Kaikki tallennetut allekirjoitukset: ${Array.from(signatures.keys())}`
  );

  // Tarkistetaan ensin täsmällinen vastaavuus
  if (signatures.has(clientIp)) {
    console.log(`Löydettiin allekirjoitukset IP:lle ${clientIp}`);
    return res.json(signatures.get(clientIp));
  }

  // Jos ei löydy täsmällistä vastaavuutta, tarkistetaan osittaiset vastaavuudet
  for (const ip of signatures.keys()) {
    if (
      ip.includes(clientIp) ||
      clientIp.includes(ip) ||
      ip.split(".").slice(0, 3).join(".") ===
        clientIp.split(".").slice(0, 3).join(".")
    ) {
      console.log(`Löydettiin allekirjoitukset samankaltaiselle IP:lle: ${ip}`);
      return res.json(signatures.get(ip));
    }
  }

  console.log(`Allekirjoituksia ei löytynyt IP:lle ${clientIp}`);
  return res.status(404).json({ error: "Allekirjoituksia ei löytynyt" });
});

// Allekirjoitusten lataus
app.get("/api/download-signatures", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  const sessionId = req.query.session_id;

  console.log(
    `Lataus pyydetty IP:ltä ${clientIp}, session ID: ${
      sessionId || "ei saatavilla"
    }`
  );

  // Tarkistetaan ensin täsmällinen vastaavuus
  let hasSignatures = signatures.has(clientIp);
  let hasPaid = sessionId ? paidIPs.has(sessionId) : paidIPs.has(clientIp);
  let signatureIp = clientIp;

  // Jos ei löydy täsmällistä vastaavuutta, tarkistetaan osittaiset vastaavuudet
  if (!hasSignatures) {
    console.log("Etsitään osittaisia IP-vastaavuuksia latausta varten...");

    // Tarkistetaan allekirjoitukset (IP-perusteinen)
    for (const ip of signatures.keys()) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        hasSignatures = true;
        signatureIp = ip;
        console.log(
          `Löydettiin allekirjoitukset samankaltaiselle IP:lle: ${ip}`
        );
        break;
      }
    }
  }

  if (!hasPaid && sessionId) {
    // Tarkistetaan maksu session ID:n perusteella
    for (const id of paidIPs) {
      if (id.includes(sessionId) || sessionId.includes(id)) {
        hasPaid = true;
        console.log(
          `Session ID ${sessionId} vastaa maksettua session ID:tä ${id}`
        );
        break;
      }
    }
  } else if (!hasPaid) {
    // Tarkistetaan maksu IP:n perusteella (vanha tapa)
    for (const ip of paidIPs) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        hasPaid = true;
        console.log(`IP ${clientIp} vastaa osittain maksettua IP:tä ${ip}`);
        break;
      }
    }
  }

  console.log(
    `Lataus IP:lle ${clientIp}, session ID: ${
      sessionId || "ei saatavilla"
    }: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
  );

  if (!hasSignatures || !hasPaid) {
    return res
      .status(403)
      .json({ error: "Ei oikeutta ladata allekirjoituksia" });
  }

  const userSignatures = signatures.get(signatureIp);

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
      `Luodaan allekirjoitus ${index + 1} värilllä: ${userSignatures.color}`
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

  // Älä poista allekirjoituksia tai maksutilaa, jotta käyttäjä voi ladata ne uudelleen tarvittaessa
  console.log(`Allekirjoitukset ladattu onnistuneesti IP:lle ${clientIp}`);
});

// Stripe-maksun luonti
app.post("/api/create-payment", async (req, res) => {
  try {
    const clientIp = getClientIpFormatted(req);
    console.log(`Luodaan maksu IP:lle ${clientIp}`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Allekirjoitukset",
              description: "Lataa allekirjoitukset ilman vesileimaa",
            },
            unit_amount: 100, // 5 EUR
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}?canceled=true`,
      metadata: {
        clientIp,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Virhe maksun luonnissa:", error);
    res.status(500).json({ error: "Virhe maksun luonnissa" });
  }
});

// Stripe webhook käsittely
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
      console.log(
        "Kaikki tallennetut allekirjoitukset:",
        Array.from(signatures.keys())
      );
      console.log("Kaikki maksetut session ID:t:", Array.from(paidIPs));

      if (
        [
          "checkout.session.completed",
          "payment_intent.succeeded",
          "charge.succeeded",
        ].includes(event.type)
      ) {
        const session = event.data.object;
        const sessionId = session.id;
        const clientIp = session.metadata?.clientIp?.trim() || "UNKNOWN";

        console.log("Etsitään asiakkaan IP:", clientIp);
        console.log("Session ID:", sessionId);

        // Tallenna session ID maksetuksi
        paidIPs.add(sessionId);
        console.log("✅ Session ID merkitty maksetuksi:", sessionId);
        console.log(
          "Kaikki maksetut session ID:t päivityksen jälkeen:",
          Array.from(paidIPs)
        );

        // Tarkista, onko IP:llä allekirjoituksia
        if (signatures.has(clientIp)) {
          console.log("Allekirjoitukset löydetty IP:lle:", clientIp);
        } else {
          // Yritetään löytää läheinen vastaavuus
          let found = false;
          for (const ip of signatures.keys()) {
            if (
              ip.includes(clientIp) ||
              clientIp.includes(ip) ||
              ip.split(".").slice(0, 3).join(".") ===
                clientIp.split(".").slice(0, 3).join(".")
            ) {
              console.log(
                "Allekirjoitukset löydetty samankaltaiselle IP:lle:",
                ip,
                "(alkuperäinen:",
                clientIp,
                ")"
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
            console.log(
              "Saatavilla olevat IP:t:",
              Array.from(signatures.keys())
            );
          }
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("Webhook-virhe:", err.message);
      return res.status(400).send(`Webhook-virhe: ${err.message}`);
    }
  }
);

// Sähköpostin lähetys
app.post("/api/send-email", async (req, res) => {
  try {
    const { email } = req.body;
    const clientIp = getClientIpFormatted(req);
    const sessionId = req.query.session_id;

    // Tarkista onko IP:llä allekirjoituksia
    const hasSignatures = signatures.has(clientIp);

    // Tarkista onko maksettu session ID:n tai IP:n perusteella
    let hasPaid = false;

    if (sessionId) {
      hasPaid = paidIPs.has(sessionId);
    } else {
      hasPaid = paidIPs.has(clientIp);

      // Tarkista osittaiset vastaavuudet
      if (!hasPaid) {
        for (const id of paidIPs) {
          if (id.includes(clientIp) || clientIp.includes(id)) {
            hasPaid = true;
            break;
          }
        }
      }
    }

    if (!email || !hasSignatures || !hasPaid) {
      return res.status(400).json({
        error: "Virheellinen pyyntö tai ei oikeutta lähettää sähköpostia",
      });
    }

    res.json({ success: true, message: "Sähköposti lähetetty onnistuneesti" });
  } catch (error) {
    console.error("Virhe sähköpostin lähetyksessä:", error);
    res.status(500).json({ error: "Virhe sähköpostin lähetyksessä" });
  }
});

// Debug-reitti
app.get("/api/debug", (req, res) => {
  const clientIp = getClientIpFormatted(req);
  const sessionId = req.query.session_id;

  // Tarkista onko maksettu session ID:n tai IP:n perusteella
  let hasPaid = false;

  if (sessionId) {
    hasPaid = paidIPs.has(sessionId);
  } else {
    hasPaid = paidIPs.has(clientIp);
  }

  res.json({
    clientIp,
    sessionId: sessionId || "ei saatavilla",
    hasSignatures: signatures.has(clientIp),
    hasPaid,
    signaturesSize: signatures.size,
    paidIPsSize: paidIPs.size,
    paidIPs: Array.from(paidIPs),
  });
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
    `Luotu karusellin allekirjoitus nimelle "${name}" fontilla ${fontStyle.name} (${fontStyle.font})`
  );

  res.json({ image: signatureImage });
});

// Debug-reitti
app.get("/api/debug-session", (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID puuttuu" });
  }

  const isPaid = paidIPs.has(sessionId);

  res.json({
    sessionId,
    isPaid,
    allPaidIds: Array.from(paidIPs),
    includes: Array.from(paidIPs).some(
      (id) => id.includes(sessionId) || sessionId.includes(id)
    ),
  });
});

export default app;
