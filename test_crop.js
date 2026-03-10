const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const url = 'https://payments.stripe.com/oxxo/voucher/live_YWNjdF8xT2tHMFJFRlkxV0VVdGdSLF9VNTNYZlQ5NmE0VVhUU0ZJMGdybkdsRXFaOVVRWkJp0100eZz9U5bt?locale=es-MX';
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200 });

    await page.goto(url, { waitUntil: 'networkidle0' });

    const clientName = "DANIEL HUMBERTO SOTO VILLEGAS";

    const clips = await page.evaluate((name) => {
        let target = document.querySelector('.loc_instructionsToPay') || document.querySelector('.OXXO-instructions');
        if (target && target.parentNode) {
            const div = document.createElement('div');
            div.textContent = name;
            div.style.textAlign = 'center';
            div.style.fontSize = '18px';
            div.style.fontWeight = 'bold';
            div.style.color = '#333';
            div.style.fontFamily = 'Helvetica, Arial, sans-serif';
            div.style.margin = '15px 0';
            div.style.padding = '0';
            div.style.width = '100%';
            target.parentNode.insertBefore(div, target);
        }

        const getRect = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const res = el.getBoundingClientRect();
            return { x: res.x, y: res.y, width: res.width, height: res.height };
        };

        const voucher = getRect('.Voucher');
        const contentCard = getRect('.ContentCard');
        const chromeSpace = getRect('.Chrome .flex-container.spacing-16.direction-column');

        return { voucher, contentCard, chromeSpace };
    }, clientName);

    console.log("Clips available:", clips);

    if (clips.contentCard) {
        // hide print button before screenshot
        await page.evaluate(() => {
            const btn = document.querySelector('.HostedVoucherButton');
            if (btn) btn.style.display = 'none';
        });
        await page.screenshot({ path: '/app/test_content_card.jpg', clip: clips.contentCard });
    }

    // Test with manual padding around Voucher if contentCard doesn't work well
    if (clips.voucher) {
        const padRect = {
            x: Math.max(0, clips.voucher.x - 30),
            y: Math.max(0, clips.voucher.y - 30),
            width: clips.voucher.width + 60,
            height: clips.voucher.height + 60
        };
        await page.screenshot({ path: '/app/test_voucher_padded.jpg', clip: padRect });
    }

    await browser.close();
})();
