const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const PDF_DIR = 'C:\\Users\\SW-ETIK\\Desktop\\Formularios';

async function extraerTexto() {
  // Vamos a revisar el PDF de RAL y el de Berel
  const archivos = ['RA -28 Formulario Base Entintable 4389 para Ventas.pdf', '09_BEREL_INTERNATIONAL.pdf'];
  
  for (const arch of archivos) {
    const ruta = path.join(PDF_DIR, arch);
    if (!fs.existsSync(ruta)) {
        console.log("No encontre: " + arch);
        continue;
    }
    const data = new Uint8Array(fs.readFileSync(ruta));
    const doc = await pdfjs.getDocument(data).promise;
    const page = await doc.getPage(1); // Solo la primera página
    const textContent = await page.getTextContent();
    
    console.log(`\n=========================================`);
    console.log(`📄 PRIMERAS LÍNEAS DE: ${arch}`);
    console.log(`=========================================\n`);
    
    // Imprimir las primeras 15 líneas de texto tal cual las ve la computadora
    textContent.items.slice(0, 20).forEach(item => {
      console.log(`[X: ${item.transform[4].toFixed(0)}, Y: ${item.transform[5].toFixed(0)}] -> "${item.str}"`);
    });
  }
}

extraerTexto();