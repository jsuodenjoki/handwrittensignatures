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
const paymentTimes = new Map();
const userSignatureData = new Map();
const userPaymentData = new Map();

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

// IP-osoitteen hakureitti
app.get("/api/get-client-ip", (req, res) => {
  res.send(getClientIpFormatted(req));
});

// Allekirjoitusten tilan tarkistus
app.get("/api/check-signatures", (req, res) => {
  // Käytä joko URL-parametria tai fallback IP-osoitteeseen
  const clientIp = req.query.clientIp || getClientIpFormatted(req);
  const hasSignatures = signatures.has(clientIp);

  // Tarkistetaan myös osittaiset IP-vastaavuudet
  let hasPaid = paidIPs.has(clientIp);

  if (!hasPaid) {
    // Tarkistetaan osittaiset vastaavuudet
    for (const ip of paidIPs) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        hasPaid = true;
        console.log(`IP ${clientIp} matches partially paid IP: ${ip}`);
        // Lisätään tämä IP myös maksettuihin, jotta jatkossa tarkistus on nopeampi
        paidIPs.add(clientIp);
        break;
      }
    }
  }

  console.log(
    `Checking status for IP: ${clientIp}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
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
  const clientIp = getClientIpFormatted(req);
  console.log(`Creating signatures: name=${name}, color=${color}`);

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of signatureFonts) {
    const signatureImage = createSignature(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  // Tallennetaan allekirjoitukset palvelimelle
  userSignatureData.set(clientIp, {
    name,
    color,
    images: signatureImages,
    createdAt: new Date().toISOString(),
  });

  // Palauta kuvat suoraan
  res.json({ images: signatureImages });
});

// Allekirjoitusten hakeminen
app.get("/api/get-signatures", (req, res) => {
  // Käytä joko URL-parametria tai fallback IP-osoitteeseen
  const clientIp = req.query.clientIp || getClientIpFormatted(req);
  console.log(`Getting signatures for IP: ${clientIp}`);
  console.log(`All stored signatures: ${Array.from(signatures.keys())}`);

  // Tarkistetaan ensin täsmällinen vastaavuus
  if (signatures.has(clientIp)) {
    console.log(`Found signatures for IP: ${clientIp}`);
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
      console.log(`Found signatures for similar IP: ${ip}`);
      return res.json(signatures.get(ip));
    }
  }

  console.log(`No signatures found for IP: ${clientIp}`);
  return res.status(404).json({ error: "No signatures found" });
});

// Allekirjoitusten lataus
app.get("/api/download-signatures", (req, res) => {
  // Käytä joko URL-parametria tai fallback IP-osoitteeseen
  const clientIp = req.query.clientIp || getClientIpFormatted(req);

  // Tarkistetaan ensin täsmällinen vastaavuus
  let hasSignatures = signatures.has(clientIp);
  let hasPaid = paidIPs.has(clientIp);
  let signatureIp = clientIp;

  // Jos ei löydy täsmällistä vastaavuutta, tarkistetaan osittaiset vastaavuudet
  if (!hasSignatures || !hasPaid) {
    console.log("Searching for partial IP matches for download...");

    // Tarkistetaan allekirjoitukset
    if (!hasSignatures) {
      for (const ip of signatures.keys()) {
        if (
          ip.includes(clientIp) ||
          clientIp.includes(ip) ||
          ip.split(".").slice(0, 3).join(".") ===
            clientIp.split(".").slice(0, 3).join(".")
        ) {
          hasSignatures = true;
          signatureIp = ip; // Tallennetaan löydetty IP
          console.log(`Found signatures for similar IP: ${ip}`);
          break;
        }
      }
    }

    // Tarkistetaan maksutila
    if (!hasPaid) {
      for (const ip of paidIPs) {
        if (
          ip.includes(clientIp) ||
          clientIp.includes(ip) ||
          ip.split(".").slice(0, 3).join(".") ===
            clientIp.split(".").slice(0, 3).join(".")
        ) {
          hasPaid = true;
          console.log(`Found payment status for similar IP: ${ip}`);
          break;
        }
      }
    }
  }

  console.log(
    `Downloading for IP: ${clientIp}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
  );

  if (!hasSignatures || !hasPaid) {
    return res
      .status(403)
      .json({ error: "No permission to download signatures" });
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

  // Älä poista allekirjoituksia tai maksutilaa, jotta käyttäjä voi ladata ne uudelleen tarvittaessa
  console.log(`Signatures downloaded successfully for IP: ${clientIp}`);
});

// Stripe checkout session luonti
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { name } = req.body;
    const clientIp = getClientIpFormatted(req);

    // Luo Stripe checkout session
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
            unit_amount: 100, // 5€ sentteinä
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.origin}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}?canceled=true`,
      metadata: {
        clientIp: clientIp, // Tallennetaan asiakkaan IP-osoite metadataan
      },
    });

    // Tallennetaan session tiedot palvelimelle
    userPaymentData.set(clientIp, {
      sessionId: session.id,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Virhe checkout-session luonnissa:", error);
    res.status(500).json({ error: "Virhe checkout-session luonnissa" });
  }
});

// Sähköpostin lähetys
app.post("/api/send-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Sähköpostiosoite puuttuu",
      });
    }

    // Tässä voit toteuttaa sähköpostin lähetyksen
    // Koska tiedot ovat nyt localStoragessa, ei tarvitse tarkistaa palvelimelta

    res.json({ success: true, message: "Sähköposti lähetetty onnistuneesti" });
  } catch (error) {
    console.error("Virhe sähköpostin lähetyksessä:", error);
    res.status(500).json({ error: "Virhe sähköpostin lähetyksessä" });
  }
});

// Debug-reitti
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

// Allekirjoitusten palautus
app.post("/api/restore-signatures", (req, res) => {
  const { name, images } = req.body;
  const clientIp = getClientIpFormatted(req);

  if (!name || !images || !Array.isArray(images)) {
    return res.status(400).json({ error: "Virheellinen pyyntö" });
  }

  console.log(`Restoring signatures for IP: ${clientIp}, name: ${name}`);

  signatures.set(clientIp, {
    name,
    images,
    createdAt: new Date().toISOString(),
  });

  console.log("All stored signatures:");
  signatures.forEach((value, key) => {
    console.log(
      `IP: ${key}, Name: ${value.name}, Images: ${value.images.length}`
    );
  });

  res.json({ success: true });
});

// Lisätään webhook Stripe-maksun käsittelyyn
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

  // Käsitellään onnistunut maksu
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Haetaan asiakkaan IP-osoite metadatasta
    const clientIp = session.metadata?.clientIp;

    if (clientIp) {
      // Merkitään maksu suoritetuksi
      paidIPs.add(clientIp);
      paymentTimes.set(clientIp, Date.now());

      // Päivitetään maksun tila palvelimelle
      if (userPaymentData.has(clientIp)) {
        const paymentData = userPaymentData.get(clientIp);
        paymentData.status = "paid";
        paymentData.paidAt = new Date().toISOString();
        userPaymentData.set(clientIp, paymentData);
      } else {
        userPaymentData.set(clientIp, {
          sessionId: session.id,
          status: "paid",
          paidAt: new Date().toISOString(),
        });
      }

      console.log(`Payment successful for IP: ${clientIp}`);
    } else {
      console.error("Client IP not found in session metadata");
    }
  }

  res.json({ received: true });
});

// Lisätään uusi reitti allekirjoitustietojen hakemiseen palvelimelta
app.get("/api/get-user-data", (req, res) => {
  const clientIp = getClientIpFormatted(req);

  const signatureData = userSignatureData.get(clientIp) || null;
  const paymentData = userPaymentData.get(clientIp) || null;
  const hasPaid = paidIPs.has(clientIp);

  res.json({
    signatureData,
    paymentData,
    hasPaid,
  });
});

// Päivitetään maksun tarkistusreitti käyttämään palvelinpuolen tallennusta
app.get("/api/check-payment/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const clientIp = getClientIpFormatted(req);

    console.log(
      `Checking payment status for sessionId: ${sessionId}, IP: ${clientIp}`
    );

    // Tarkista ensin, onko käyttäjä jo merkitty maksaneeksi
    if (paidIPs.has(clientIp)) {
      console.log(`IP ${clientIp} is already marked as paid`);

      // Päivitä maksutiedot palvelimelle, jos niitä ei vielä ole
      if (!userPaymentData.has(clientIp)) {
        userPaymentData.set(clientIp, {
          sessionId,
          status: "paid",
          paidAt: new Date().toISOString(),
        });
      }

      return res.json({ success: true, status: "paid" });
    }

    // Tarkista osittaiset vastaavuudet
    for (const ip of paidIPs) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        console.log(`IP ${clientIp} matches partially paid IP: ${ip}`);
        paidIPs.add(clientIp); // Lisää tämä IP myös maksettuihin

        // Päivitä maksutiedot palvelimelle
        userPaymentData.set(clientIp, {
          sessionId,
          status: "paid",
          paidAt: new Date().toISOString(),
        });

        return res.json({ success: true, status: "paid" });
      }
    }

    // Tarkista palvelimelle tallennetut maksutiedot
    if (userPaymentData.has(clientIp)) {
      const paymentData = userPaymentData.get(clientIp);
      if (paymentData.status === "paid") {
        paidIPs.add(clientIp);
        return res.json({ success: true, status: "paid" });
      }
    }

    // Jos ei löydy paikallisesti, tarkista Stripe API:sta
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      console.log(
        `Payment confirmed by Stripe API for sessionId: ${sessionId}`
      );

      // Merkitse IP maksetuksi
      paidIPs.add(clientIp);
      paymentTimes.set(clientIp, Date.now());

      // Päivitä maksutiedot palvelimelle
      userPaymentData.set(clientIp, {
        sessionId,
        status: "paid",
        paidAt: new Date().toISOString(),
      });

      console.log(`IP ${clientIp} marked as paid through Stripe API`);

      return res.json({ success: true, status: "paid" });
    }

    // Päivitä maksun tila palvelimelle
    userPaymentData.set(clientIp, {
      sessionId,
      status: session.payment_status,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ success: true, status: session.payment_status });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res
      .status(500)
      .json({ success: false, error: "Error checking payment status" });
  }
});

// Päivitetään allekirjoitusten tallennusreitti
app.post("/api/save-signatures", (req, res) => {
  const { name, images, color } = req.body;
  const clientIp = getClientIpFormatted(req);

  if (!name || !images || !Array.isArray(images)) {
    return res.status(400).json({ success: false, error: "Invalid request" });
  }

  // Tallenna allekirjoitukset Map-rakenteeseen
  signatures.set(clientIp, {
    name,
    images,
    color,
    createdAt: new Date().toISOString(),
  });

  // Tallenna myös palvelinpuolen tietorakenteeseen
  userSignatureData.set(clientIp, {
    name,
    color,
    images,
    createdAt: new Date().toISOString(),
  });

  console.log(`Signatures saved for IP: ${clientIp}, name: ${name}`);

  res.json({ success: true });
});

// Päivitetään käyttäjätietojen nollausreitti
app.post("/api/reset-user-data", (req, res) => {
  const clientIp = getClientIpFormatted(req);

  // Poista tiedot serverin tietorakenteista
  if (signatures.has(clientIp)) {
    signatures.delete(clientIp);
  }

  if (paidIPs.has(clientIp)) {
    paidIPs.delete(clientIp);
  }

  if (paymentTimes.has(clientIp)) {
    paymentTimes.delete(clientIp);
  }

  if (userSignatureData.has(clientIp)) {
    userSignatureData.delete(clientIp);
  }

  if (userPaymentData.has(clientIp)) {
    userPaymentData.delete(clientIp);
  }

  console.log(`Deleted data for IP: ${clientIp}`);
  res.json({ success: true, message: "User data deleted." });
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

export default app;
