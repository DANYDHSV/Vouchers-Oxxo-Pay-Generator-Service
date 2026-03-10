const puppeteer = require('puppeteer');
(async () => {
    const url = 'https://payments.stripe.com/oxxo/voucher/live_YWNjdF8xT2tHMFJFRlkxV0VVdGdSLF9VNTNYZlQ5NmE0VVhUU0ZJMGdybkdsRXFaOVVRWkJp0100eZz9U5bt?locale=es-MX';
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    const clientName = "DANIEL HUMBERTO";
    const coords = await page.evaluate((name) => {
        let target = document.querySelector('.loc_instructionsToPay') || document.querySelector('.OXXO-instructions');
        let injectedRect = null;
        if (target && target.parentNode) {
            const div = document.createElement('div');
            div.textContent = name;
            div.style.padding = '15px 0';
            target.parentNode.insertBefore(div, target);
            injectedRect = div.getBoundingClientRect();
        }
        let voucherRect = null;
        const voucherEl = document.querySelector('.Voucher') || document.querySelector('.ContentCard');
        if (voucherEl) voucherRect = voucherEl.getBoundingClientRect();
        
        return { injected: injectedRect ? {x: injectedRect.x, y: injectedRect.y, w: injectedRect.width, h: injectedRect.height}: null,
                 voucher: voucherRect ? {x: voucherRect.x, y: voucherRect.y, w: voucherRect.width, h: voucherRect.height} : null };
    }, clientName);
    console.log(coords);
    await browser.close();
})();
