const http = require('http');
const { exec } = require('child_process');

http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            // Extrae la URL del cuerpo de la solicitud
            const params = new URLSearchParams(body);
            const url = params.get('url');

            if (!url) {
                res.writeHead(400);
                res.end('URL is required');
                return;
            }

            // Ejecuta el script generate_screenshot.js con la URL
            exec(`node /app/generate_screenshot.js ${encodeURIComponent(url)}`, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing script:', stderr || error.message);
                    res.writeHead(500);
                    res.end(stderr || 'Internal Server Error');
                    return;
                }
                res.writeHead(200);
                res.end(stdout);
            });
        } catch (err) {
            console.error('Error processing request:', err.message);
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    });
}).listen(4000, '0.0.0.0', () => {
    console.log('Puppeteer service listening on port 4000');
});
