const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const url = 'https://payments.stripe.com/oxxo/voucher/live_YWNjdF8xT2tHMFJFRlkxV0VVdGdSLF9VNTNYZlQ5NmE0VVhUU0ZJMGdybkdsRXFaOVVRWkJp0100eZz9U5bt';
    let finalUrl = url;
    try {
        const parsedUrl = new URL(finalUrl);
        parsedUrl.searchParams.set('locale', 'es-MX');
        finalUrl = parsedUrl.toString();
    } catch (e) { }

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-MX']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-MX,es;q=0.9' });

    await page.goto(finalUrl, { waitUntil: 'networkidle0' });

    const clientName = "DANIEL HUMBERTO SOTO VILLEGAS";

    let clipRect = await page.evaluate((name) => {
        let target = document.querySelector('.loc_instructionsToPay') || document.querySelector('.OXXO-instructions');
        if (target && target.parentNode) {
            const div = document.createElement('div');
            div.textContent = name;
            div.style.textAlign = 'center';
            div.style.fontSize = '24px';
            div.style.fontWeight = 'bold';
            div.style.color = '#ff0000'; // Make it red to see easily in debug
            target.parentNode.insertBefore(div, target);
        } else {
            const fallbackDiv = document.createElement('div');
            fallbackDiv.style.position = 'absolute';
            fallbackDiv.style.top = '10px';
            fallbackDiv.style.left = '0';
            fallbackDiv.style.width = '100%';
            fallbackDiv.style.textAlign = 'center';
            fallbackDiv.style.fontWeight = 'bold';
            fallbackDiv.style.fontSize = '18px';
            fallbackDiv.textContent = name;
            fallbackDiv.style.color = '#ff0000';
            document.body.appendChild(fallbackDiv);
        }

        const voucherEl = document.querySelector('.Voucher') || document.querySelector('.ContentCard') || document.body;
        if (voucherEl) {
            const { x, y, width, height } = voucherEl.getBoundingClientRect();
            return { x, y, width, height };
        }
        return null;
    }, clientName);

    // Grab html to analyze
    const html = await page.content();
    fs.writeFileSync('/app/stripe_page.html', html);

    // Save FULL screenshot
    await page.screenshot({ path: '/app/full_screenshot.jpg' });

    // Save CROPPED screenshot
    if (clipRect) {
        const croppedBuffer = await page.screenshot({ clip: clipRect });
        fs.writeFileSync('/app/cropped_screenshot.jpg', croppedBuffer);
    }

    await browser.close();
})();
