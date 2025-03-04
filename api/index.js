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
        console.log(`IP ${clientIp} vastaa osittain maksettua IP:tä ${ip}`);
        // Lisätään tämä IP myös maksettuihin, jotta jatkossa tarkistus on nopeampi
        paidIPs.add(clientIp);
        break;
      }
    }
  }

  console.log(
    `Tarkistetaan tila IP:lle ${clientIp}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
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

  // Palauta kuvat suoraan ilman tallennusta
  res.json({ images: signatureImages });
});

// Allekirjoitusten hakeminen
app.get("/api/get-signatures", (req, res) => {
  // Käytä joko URL-parametria tai fallback IP-osoitteeseen
  const clientIp = req.query.clientIp || getClientIpFormatted(req);
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
  // Käytä joko URL-parametria tai fallback IP-osoitteeseen
  const clientIp = req.query.clientIp || getClientIpFormatted(req);

  // Tarkistetaan ensin täsmällinen vastaavuus
  let hasSignatures = signatures.has(clientIp);
  let hasPaid = paidIPs.has(clientIp);
  let signatureIp = clientIp;

  // Jos ei löydy täsmällistä vastaavuutta, tarkistetaan osittaiset vastaavuudet
  if (!hasSignatures || !hasPaid) {
    console.log("Etsitään osittaisia IP-vastaavuuksia latausta varten...");

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
          console.log(
            `Löydettiin allekirjoitukset samankaltaiselle IP:lle: ${ip}`
          );
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
          console.log(`Löydettiin maksutila samankaltaiselle IP:lle: ${ip}`);
          break;
        }
      }
    }
  }

  console.log(
    `Lataus IP:lle ${clientIp}: hasSignatures=${hasSignatures}, hasPaid=${hasPaid}`
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

// Stripe checkout session luonti
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { name } = req.body;

    // Luo Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Allekirjoitukset",
              description: `Allekirjoitukset nimelle: ${name}`,
            },
            unit_amount: 100, // 1€ sentteinä
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.origin}?success=true`,
      cancel_url: `${req.headers.origin}?canceled=true`,
    });

    res.json({ url: session.url });
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
    `Luotu karusellin allekirjoitus nimelle "${name}" fontilla ${fontStyle.name} (${fontStyle.font})`
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

  console.log(`Palautetaan allekirjoitukset IP:lle ${clientIp}, nimi: ${name}`);

  signatures.set(clientIp, {
    name,
    images,
    createdAt: new Date().toISOString(),
  });

  console.log("Kaikki tallennetut allekirjoitukset:");
  signatures.forEach((value, key) => {
    console.log(
      `IP: ${key}, Nimi: ${value.name}, Kuvia: ${value.images.length}`
    );
  });

  res.json({ success: true });
});

// Lisätään uusi reitti maksun tarkistukseen
app.get("/api/check-payment/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const clientIp = getClientIpFormatted(req);

    console.log(
      `Tarkistetaan maksun tila sessionId:lle ${sessionId}, IP: ${clientIp}`
    );

    // Tarkista ensin, onko käyttäjä jo merkitty maksaneeksi
    if (paidIPs.has(clientIp)) {
      console.log(`IP ${clientIp} on jo merkitty maksaneeksi`);
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
        console.log(`IP ${clientIp} vastaa osittain maksettua IP:tä ${ip}`);
        paidIPs.add(clientIp); // Lisää tämä IP myös maksettuihin
        return res.json({ success: true, status: "paid" });
      }
    }

    // Jos ei löydy paikallisesti, tarkista Stripe API:sta
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      console.log(
        `Maksu vahvistettu Stripe API:sta sessionId:lle ${sessionId}`
      );

      // Merkitse IP maksetuksi
      paidIPs.add(clientIp);
      console.log(`IP ${clientIp} merkitty maksetuksi Stripe API:n kautta`);

      return res.json({ success: true, status: "paid" });
    }

    return res.json({ success: true, status: session.payment_status });
  } catch (error) {
    console.error("Virhe maksun tarkistuksessa:", error);
    return res
      .status(500)
      .json({ success: false, error: "Virhe maksun tarkistuksessa" });
  }
});

// Reset user data
app.post("/api/reset-user-data", (req, res) => {
  const { clientIp } = req.body;

  if (!clientIp) {
    return res
      .status(400)
      .json({ success: false, message: "Client IP puuttuu." });
  }

  // Poista tiedot serverin Mapista ja Setistä
  if (signatures.has(clientIp)) {
    signatures.delete(clientIp);
  }

  if (paidIPs.has(clientIp)) {
    paidIPs.delete(clientIp);
  }

  console.log(`Poistettu tiedot IP-osoitteelle: ${clientIp}`);
  res.json({ success: true, message: "Käyttäjän tiedot poistettu." });
});

// Allekirjoitusten luonti ilman vesileimaa
app.post("/api/create-clean-signatures", (req, res) => {
  const { name, color } = req.body;
  console.log(`Luodaan puhtaat allekirjoitukset: nimi=${name}, väri=${color}`);

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
