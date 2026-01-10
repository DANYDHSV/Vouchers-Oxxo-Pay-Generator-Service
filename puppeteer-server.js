const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4000;

app.get('/screenshot', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL is required');
  }

  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);
    
    const screenshotPath = path.join(__dirname, 'screenshot.png');
    await page.screenshot({ path: screenshotPath });
    await browser.close();

    // Enviar la imagen de vuelta como respuesta
    res.sendFile(screenshotPath, (err) => {
      if (err) {
        res.status(500).send('Error sending file');
      }
      // Eliminar la captura de pantalla después de enviarla
      fs.unlinkSync(screenshotPath);
    });
  } catch (error) {
    res.status(500).send('Error taking screenshot');
  }
});

app.listen(PORT, () => {
  console.log(`Puppeteer service listening on port ${PORT}`);
});
