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
const _0x5f4e2a = stripePackage(process.env.STRIPE_SECRET_KEY);
const _0x3a7b1c = express();
const _0x2c8d9f = new Map();
const _0x1e6f3d = new Set();

//3. MIDDLEWARE MÄÄRITTELYT
_0x3a7b1c.use(cors());
_0x3a7b1c.use("/api/webhook", express.raw({ type: "application/json" }));
_0x3a7b1c.use(express.json());

//4. IP-OSOITTEEN KÄSITTELYFUNKTIOT
function _0x7a2e4b(req) {
  return req.headers["x-forwarded-for"] || req.connection.remoteAddress;
}

function _0x9c1d3e(req) {
  const ip = _0x7a2e4b(req);
  const formattedIp = ip.includes(",") ? ip.split(",")[0].trim() : ip.trim();
  return formattedIp.replace(/^::ffff:/, "");
}

//5. FONTTIEN REKISTERÖINTI JA HALLINTA
registerFont(path.join(__dirname, "../public/fonts2/poppins.ttf"), {
  family: "Poppins",
});

const _0x4d8e7f = path.join(__dirname, "../public/fonts");
const _0x6a2c1d = [];

try {
  if (fs.existsSync(_0x4d8e7f)) {
    const _0x8a7b3c = fs.readdirSync(_0x4d8e7f);

    _0x8a7b3c.forEach((_0x2f1a3d) => {
      if (_0x2f1a3d.endsWith(".ttf")) {
        const _0x5e8c2a = _0x2f1a3d.replace(".ttf", "").replace(/[-_]/g, " ");
        const _0x7d9e3f = _0x5e8c2a.replace(/\s+/g, "");
        registerFont(path.join(_0x4d8e7f, _0x2f1a3d), { family: _0x7d9e3f });

        _0x6a2c1d.push({
          name: _0x5e8c2a.toLowerCase(),
          font:
            _0x5e8c2a.toLowerCase() === "omafontti1" ||
            _0x5e8c2a.toLowerCase() === "omafontti3"
              ? `100px '${_0x7d9e3f}'`
              : `40px '${_0x7d9e3f}'`,
        });
      }
    });
  }

  if (_0x6a2c1d.length === 0) {
    _0x6a2c1d.push(
      { name: "Arial", font: "40px Arial, sans-serif" },
      { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
      { name: "Courier New", font: "40px 'Courier New', monospace" }
    );
  }
} catch (error) {
  _0x6a2c1d.push(
    { name: "Arial", font: "40px Arial, sans-serif" },
    { name: "Times New Roman", font: "40px 'Times New Roman', serif" },
    { name: "Courier New", font: "40px 'Courier New', monospace" }
  );
}

//6. ALLEKIRJOITUSTEN LUONTIFUNKTIOT
function _0x3e7c8d(name, fontStyle, color = "black") {
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

function _0x2f8a1e(name, fontStyle, color = "black") {
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
_0x3a7b1c.get("/api/get-client-ip", (req, res) => {
  res.send(_0x9c1d3e(req));
});

// Allekirjoitusten tilan tarkistus
_0x3a7b1c.get("/api/check-signatures", (req, res) => {
  const clientIp = req.query.clientIp || _0x9c1d3e(req);
  const hasSignatures = _0x2c8d9f.has(clientIp);

  let hasPaid = _0x1e6f3d.has(clientIp);

  if (!hasPaid) {
    for (const ip of _0x1e6f3d) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        hasPaid = true;
        _0x1e6f3d.add(clientIp);
        break;
      }
    }
  }

  res.json({
    hasSignatures,
    hasPaid,
    canDownload: hasSignatures && hasPaid,
  });
});

// Allekirjoitusten luonti
_0x3a7b1c.post("/api/create-signatures", (req, res) => {
  const { name, color } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of _0x6a2c1d) {
    const signatureImage = _0x2f8a1e(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  res.json({ images: signatureImages });
});

// Allekirjoitusten hakeminen
_0x3a7b1c.get("/api/get-signatures", (req, res) => {
  const clientIp = req.query.clientIp || _0x9c1d3e(req);

  if (_0x2c8d9f.has(clientIp)) {
    return res.json(_0x2c8d9f.get(clientIp));
  }

  for (const ip of _0x2c8d9f.keys()) {
    if (
      ip.includes(clientIp) ||
      clientIp.includes(ip) ||
      ip.split(".").slice(0, 3).join(".") ===
        clientIp.split(".").slice(0, 3).join(".")
    ) {
      return res.json(_0x2c8d9f.get(ip));
    }
  }

  return res.status(404).json({ error: "No signatures found" });
});

// Allekirjoitusten lataus
_0x3a7b1c.get("/api/download-signatures", (req, res) => {
  const clientIp = req.query.clientIp || _0x9c1d3e(req);

  let hasSignatures = _0x2c8d9f.has(clientIp);
  let hasPaid = _0x1e6f3d.has(clientIp);
  let signatureIp = clientIp;

  if (!hasSignatures || !hasPaid) {
    if (!hasSignatures) {
      for (const ip of _0x2c8d9f.keys()) {
        if (
          ip.includes(clientIp) ||
          clientIp.includes(ip) ||
          ip.split(".").slice(0, 3).join(".") ===
            clientIp.split(".").slice(0, 3).join(".")
        ) {
          hasSignatures = true;
          signatureIp = ip;
          break;
        }
      }
    }

    if (!hasPaid) {
      for (const ip of _0x1e6f3d) {
        if (
          ip.includes(clientIp) ||
          clientIp.includes(ip) ||
          ip.split(".").slice(0, 3).join(".") ===
            clientIp.split(".").slice(0, 3).join(".")
        ) {
          hasPaid = true;
          break;
        }
      }
    }
  }

  if (!hasSignatures || !hasPaid) {
    return res
      .status(403)
      .json({ error: "No permission to download signatures" });
  }

  const userSignatures = _0x2c8d9f.get(signatureIp);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=signatures-${Date.now()}.zip`
  );

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", function (err) {
    res.status(500).send({ error: "Virhe tiedoston luonnissa" });
  });

  archive.pipe(res);

  _0x6a2c1d.forEach((fontStyle, index) => {
    const signatureImage = _0x3e7c8d(
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
Tiedostoja: ${_0x6a2c1d.length} kpl

Kiitos että käytit palveluamme!`;

  archive.append(readme, { name: "README.txt" });

  archive.finalize();
});

// Stripe checkout session luonti
_0x3a7b1c.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { name } = req.body;

    const session = await _0x5f4e2a.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Handwritten Signatures",
              description: `Handwritten signatures for ${name}`,
            },
            unit_amount: 100,
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
    res.status(500).json({ error: "Virhe checkout-session luonnissa" });
  }
});

// Sähköpostin lähetys
_0x3a7b1c.post("/api/send-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Sähköpostiosoite puuttuu",
      });
    }

    res.json({ success: true, message: "Sähköposti lähetetty onnistuneesti" });
  } catch (error) {
    res.status(500).json({ error: "Virhe sähköpostin lähetyksessä" });
  }
});

// Debug-reitti
_0x3a7b1c.get("/api/debug", (req, res) => {
  const clientIp = _0x9c1d3e(req);
  res.json({
    clientIp,
    hasSignatures: _0x2c8d9f.has(clientIp),
    hasPaid: _0x1e6f3d.has(clientIp),
    signaturesSize: _0x2c8d9f.size,
    paidIPsSize: _0x1e6f3d.size,
  });
});

// Karusellin allekirjoitusten luonti
_0x3a7b1c.post("/api/create-signature-for-carousel", (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const fontStyle = _0x6a2c1d.find(
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

  res.json({ image: signatureImage });
});

// Allekirjoitusten palautus
_0x3a7b1c.post("/api/restore-signatures", (req, res) => {
  const { name, images } = req.body;
  const clientIp = _0x9c1d3e(req);

  if (!name || !images || !Array.isArray(images)) {
    return res.status(400).json({ error: "Virheellinen pyyntö" });
  }

  _0x2c8d9f.set(clientIp, {
    name,
    images,
    createdAt: new Date().toISOString(),
  });

  res.json({ success: true });
});

// Lisätään uusi reitti maksun tarkistukseen
_0x3a7b1c.get("/api/check-payment/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const clientIp = _0x9c1d3e(req);

    if (_0x1e6f3d.has(clientIp)) {
      return res.json({ success: true, status: "paid" });
    }

    for (const ip of _0x1e6f3d) {
      if (
        ip.includes(clientIp) ||
        clientIp.includes(ip) ||
        ip.split(".").slice(0, 3).join(".") ===
          clientIp.split(".").slice(0, 3).join(".")
      ) {
        _0x1e6f3d.add(clientIp);
        return res.json({ success: true, status: "paid" });
      }
    }

    const session = await _0x5f4e2a.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      _0x1e6f3d.add(clientIp);
      return res.json({ success: true, status: "paid" });
    }

    return res.json({ success: true, status: session.payment_status });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "Error checking payment status" });
  }
});

// Reset user data
_0x3a7b1c.post("/api/reset-user-data", (req, res) => {
  const { clientIp } = req.body;

  if (!clientIp) {
    return res
      .status(400)
      .json({ success: false, message: "Client IP puuttuu." });
  }

  if (_0x2c8d9f.has(clientIp)) {
    _0x2c8d9f.delete(clientIp);
  }

  if (_0x1e6f3d.has(clientIp)) {
    _0x1e6f3d.delete(clientIp);
  }

  res.json({ success: true, message: "User data deleted." });
});

// Allekirjoitusten luonti ilman vesileimaa
_0x3a7b1c.post("/api/create-clean-signatures", (req, res) => {
  const { name, color } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Nimi puuttuu" });
  }

  const signatureImages = [];

  for (const fontStyle of _0x6a2c1d) {
    const signatureImage = _0x3e7c8d(name, fontStyle, color);
    signatureImages.push(signatureImage);
  }

  res.json({ images: signatureImages });
});

export default _0x3a7b1c;
