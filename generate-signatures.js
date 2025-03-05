const fs = require("fs");
const path = require("path");
const { createCanvas, registerFont } = require("canvas");

// Rekisteröi fontit
registerFont(path.join(__dirname, "public/fonts/omafontti3.ttf"), {
  family: "OmaFontti3",
});

// Esimerkkinimet
const exampleNames = [
  "Emma Johnson",
  "James Smith",
  "Olivia Williams",
  "Liam Brown",
  "Sophia Davis",
  "Benjamin Wilson",
  "Charlotte Miller",
  "Ethan Moore",
  "Isabella Taylor",
  "Mason Anderson",
  "Mia Thomas",
  "Alexander Harris",
  "Amelia Martin",
  "Daniel Thompson",
  "Harper White",
  "Henry Clark",
  "Evelyn Rodriguez",
  "Michael Lewis",
  "Abigail Walker",
  "Lucas Hall",
  "Emily Allen",
  "William Young",
  "Scarlett King",
  "Elijah Scott",
  "Grace Wright",
  "Oliver Green",
  // Lisää muut nimet tähän
];

// Varmista että hakemisto on olemassa
const signatureDir = path.join(__dirname, "public/signatures");
if (!fs.existsSync(signatureDir)) {
  fs.mkdirSync(signatureDir, { recursive: true });
}

// Luo allekirjoitus
function createSignature(name, fontFamily, color) {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Käytä samaa fonttikokoa kuin API-reitissä
  ctx.font = `110px ${fontFamily}`; // Suurempi fonttikoko
  ctx.fillStyle = color;
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

  return canvas.toBuffer("image/png");
}

// Lisää tämä skriptin alkuun
process.on("uncaughtException", (err) => {
  console.error("Käsittelemätön virhe:", err);
  process.exit(1);
});

// Luo allekirjoitukset jokaiselle nimelle
exampleNames.forEach((name, index) => {
  try {
    // Luodaan allekirjoitus nimelle: name
    const buffer = createSignature(name, "OmaFontti3", "#6e8efb");
    const filename = `handwritten_signature_generator_example_${index + 1}.png`;
    fs.writeFileSync(path.join(signatureDir, filename), buffer);
    // Luotu allekirjoitus: filename
  } catch (error) {
    // Virhe allekirjoituksen luonnissa (name): error
    // Heitetään virhe eteenpäin, jotta skripti keskeytyy
    throw error;
  }
});

// Kaikki allekirjoitukset luotu onnistuneesti!
