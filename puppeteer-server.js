const express = require('express');
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

const app = express();
const PORT = 4000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Variables Globales
let globalBrowser = null;
let browserRestartScheduled = false;

// Configurar la cola de concurrencia a 5 workers
const limit = pLimit(5);

// Inicializar Puppeteer Global
async function initBrowser() {
  try {
    console.log('Inicializando instancia global de Chromium...');
    globalBrowser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--lang=es-MX'
      ]
    });
    console.log('Instancia global de Chromium inicializada con éxito.');
    globalBrowser.on('disconnected', () => {
      if (browserRestartScheduled) return;

      browserRestartScheduled = true;
      globalBrowser = null;
      console.error('Chromium se desconectó inesperadamente. Reiniciando en 2s...');
      setTimeout(async () => {
        browserRestartScheduled = false;
        try {
          await initBrowser();
        } catch (restartError) {
          console.error('Error al reiniciar Chromium:', restartError);
        }
      }, 2000);
    });
  } catch (error) {
    console.error('Error al inicializar la instancia global de Chromium:', error);
    process.exit(1);
  }
}
initBrowser();

// Configuración de DB
const pool = new Pool({
  user: process.env.DB_USER || 'oxxo_user',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'oxxo_vouchers',
  password: process.env.DB_PASS || 'oxxo_secure_pass',
  port: 5432,
  max: 15,
});

// Pool para UCRM (Conexión Secundaria)
const ucrmPool = new Pool({
  user: process.env.UCRM_DB_USER,
  host: process.env.UCRM_DB_HOST,
  database: process.env.UCRM_DB_NAME,
  password: process.env.UCRM_DB_PASS,
  port: 5432,
  max: 10,
});

// Inicializar DB
async function initDB(retries = 5) {
  while (retries > 0) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          client_id INTEGER,
          amount DECIMAL(10, 2),
          stripe_url TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          voucher_filename TEXT,
          voucher_image_url TEXT,
          oxxo_reference TEXT,
          client_full_name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('Database initialized: tables checked/created.');
      return;
    } catch (err) {
      console.error(`Error initializing database (${retries} retries left):`, err.message);
      retries -= 1;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  console.error('Failed to initialize database after multiple attempts.');
}

initDB();

// 1. Crear Orden (Sync)
app.post('/orders', async (req, res) => {
  const { client_id, amount, client_full_name, oxxo_reference, stripe_url } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO orders (client_id, amount, client_full_name, oxxo_reference, stripe_url, status) 
       VALUES ($1, $2, $3, $4, $5, 'pending') 
       RETURNING id`,
      [client_id, amount, client_full_name, oxxo_reference, stripe_url]
    );

    res.json({
      status: 'pending',
      order_id: result.rows[0].id,
      message: 'Order created successfully'
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// 2. Generar Voucher (Async Trigger) - Devuelve Imagen
app.post('/orders/:id/generate', async (req, res) => {
  const { id } = req.params;
  const { url, filename } = req.body; // URL OXXO, Filename deseado

  if (!url) {
    return res.status(400).send('URL is required');
  }

  // Encolar la petición de Puppeteer con p-limit para prevenir saturación de memoria
  try {
    await limit(async () => {
      // Verificar si la orden existe
    let clientName = null;
    try {
      const orderCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      if (orderCheck.rows.length === 0) {
        return res.status(404).send('Order not found');
      }
      clientName = orderCheck.rows[0].client_full_name;
    } catch (err) {
      return res.status(500).send('Database error');
    }

    let context = null;
    let page = null;
    try {
      if (!globalBrowser) throw new Error('Global browser not initialized');
      // Usar Contexto Incógnito para aislamiento total entre cada voucher
      context = await globalBrowser.createIncognitoBrowserContext();
      page = await context.newPage();

      // Configurar Viewport
      await page.setViewport({ width: 1200, height: 800 });

      // Headers HTTP
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-MX,es-419;q=0.9,es;q=0.8,en-US;q=0.7'
      });

      // Override JS Navigator Language
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'es-MX' });
        Object.defineProperty(navigator, 'languages', { get: () => ['es-MX', 'es-419', 'es', 'en-US', 'en'] });
      });

      // Force locale=es-MX on URL
      let finalUrl = url;
      try {
        const parsedUrl = new URL(finalUrl);
        parsedUrl.searchParams.set('locale', 'es-MX');
        finalUrl = parsedUrl.toString();
      } catch (e) {
        console.error('Invalid URL format:', e);
      }

      console.log(`[Order ${id}] Navigating to:`, finalUrl);
      await page.goto(finalUrl, { waitUntil: 'networkidle0' });

      // Inyectar Nombre del Cliente en el DOM y obtener coordenadas del Voucher
      let clipRect = null;
      console.log(`[Order ${id}] ClientName retrieved:`, clientName);
      if (clientName) {
        clipRect = await page.evaluate((name) => {
          // Encontrar contenedor de instrucciones (independiente del idioma)
          let target = document.querySelector('.loc_instructionsToPay') || document.querySelector('.OXXO-instructions');

          // Agregar el nombre si encontramos donde
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
          } else {
            // Fallback
            const fallbackDiv = document.createElement('div');
            fallbackDiv.style.position = 'absolute';
            fallbackDiv.style.top = '10px';
            fallbackDiv.style.left = '0';
            fallbackDiv.style.width = '100%';
            fallbackDiv.style.textAlign = 'center';
            fallbackDiv.style.fontWeight = 'bold';
            fallbackDiv.style.fontSize = '18px';
            fallbackDiv.textContent = name;
            document.body.appendChild(fallbackDiv);
          }

          // Ocultar el botón de Imprimir ya que es solo una imagen para WhatsApp
          const printBtn = document.querySelector('.HostedVoucherButton');
          if (printBtn) printBtn.style.display = 'none';

          // Ocultar elementos que no forman parte del voucher compartido.
          const footerSelectors = [
            '.PoweredByLink', '.PoweredBy',
            '.TermsLinks', '.TermsLink',
            '[class*="PoweredBy"]', '[class*="TermsLink"]',
            'footer', '.Footer'
          ];
          footerSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => {
              element.style.display = 'none';
            });
          });

          // Obtener la caja delimitadora del contenedor principal ancho que incluye "SIIP INTERNET" y sombra
          const targetArea = document.querySelector('.Chrome .flex-container.spacing-16.direction-column')
            || document.querySelector('.ContentCard')
            || document.querySelector('.Voucher');

          if (targetArea) {
            const { x, y, width, height } = targetArea.getBoundingClientRect();
            // Agregar padding para dar respiro al recorte y emular el padding del margen blanco
            const padding = 20;
            return {
              x: Math.max(0, x - padding),
              y: Math.max(0, y - padding),
              width: width + (padding * 2),
              height: height + (padding * 2)
            };
          }
          return null; // Si no se encuentra, retornará null
        }, clientName);
      }
      console.log(`[Order ${id}] Extracted clipRect from DOM:`, clipRect);

      // Screenshot
      const screenshotOptions = {};
      if (clipRect) {
        screenshotOptions.clip = clipRect;
      } else if (req.body.clip) {
        screenshotOptions.clip = req.body.clip;
      }
      console.log(`[Order ${id}] Screenshot options:`, screenshotOptions);
      const screenshotBuffer = await page.screenshot(screenshotOptions);
      console.log(`[Order ${id}] Screenshot generated, size:`, screenshotBuffer.length);

      // Actualizar DB
      await pool.query(
        `UPDATE orders 
         SET status = 'completed', 
             voucher_filename = $1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [filename, id]
      );

      // Enviar imagen
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': screenshotBuffer.length
      });
      res.end(screenshotBuffer);

    } catch (error) {
      console.error('Error generating voucher:', error);

      // Marcar como error en DB
      await pool.query("UPDATE orders SET status = 'failed' WHERE id = $1", [id]);
      if (!res.headersSent) {
        res.status(500).send('Error generating voucher image');
      }
    } finally {
      // Garantizar la liberación segura de recursos independientemente del éxito o del error
      if (page) {
        await page.close().catch(e => console.error('Error closing page:', e));
      }
      if (context) {
        await context.close().catch(e => console.error('Error closing context:', e));
      }
    }
    }); // fin de limit block
  } catch (err) {
    console.error('Limit block processing error:', err);
    if (!res.headersSent) res.status(500).send('Service overloaded');
  }
});

app.post('/orders/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { voucher_image_url } = req.body;

  try {
    await pool.query(
      "UPDATE orders SET voucher_image_url = $1 WHERE id = $2",
      [voucher_image_url, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating order URL:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 3. Consultar Orden
app.get('/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Endpoint Legacy
app.get('/screenshot', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL is required');

  try {
    await limit(async () => {
      let context = null;
      let page = null;
      try {
        console.log('[Screenshot] Checking globalBrowser initialized...');
        if (!globalBrowser) throw new Error('Global browser not initialized');
        console.log('[Screenshot] globalBrowser is initialized. Creating context...');
        context = await globalBrowser.createIncognitoBrowserContext();
        console.log('[Screenshot] Context created. Launching new page...');
        page = await context.newPage();
        
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'es-MX,es;q=0.9'
        });
        
        let finalUrl = url;
        try {
          const parsedUrl = new URL(finalUrl);
          parsedUrl.searchParams.set('locale', 'es-MX');
          finalUrl = parsedUrl.toString();
        } catch (e) { }
        
        console.log('[Screenshot] Navigating to:', finalUrl);
        await page.goto(finalUrl);
        console.log('[Screenshot] Navigation complete. Taking screenshot...');
        const buffer = await page.screenshot();
        console.log('[Screenshot] Screenshot successful, sending response.');

        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buffer);
      } catch (e) {
        console.error('[Screenshot] Error inside limit block:', e);
        if (!res.headersSent) res.status(500).send(e.toString());
      } finally {
        if (page) {
          await page.close().catch(e => console.error('Error closing legacy page:', e));
        }
        if (context) {
          await context.close().catch(e => console.error('Error closing legacy context:', e));
        }
      }
    }); // fin de limit block
  } catch (err) {
    console.error('Legacy screenshot limit block error:', err);
    if (!res.headersSent) res.status(500).send(`Service overloaded: ${err.message}`);
  }
});

// 3. Obtener Metadata Stripe desde UCRM DB (Endpoint Auxiliar)
app.get('/stripe-metadata/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Query Join: Payment -> PaymentStripe
    // Link: payment.payment_details_id = payment_stripe.payment_stripe_id
    // Solo para pagos con provider_id = 3 (Stripe)
    const query = `
            SELECT ps.metadata, ps.stripe_id
            FROM ucrm.payment p
            JOIN ucrm.payment_stripe ps ON ps.payment_stripe_id = p.payment_details_id
            WHERE p.payment_id = $1
        `;
    const result = await ucrmPool.query(query, [id]);

    if (result.rows.length > 0) {
      res.json({
        metadata: result.rows[0].metadata,
        stripeId: result.rows[0].stripe_id
      });
    } else {
      res.status(404).json({ error: 'Metadata not found or not a Stripe payment' });
    }
  } catch (err) {
    console.error('Error fetching Stripe metadata:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 4. Actualizar User ID en Payment (Direct SQL Patch)
app.patch('/payments/:id/user', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const query = `
            UPDATE ucrm.payment
            SET user_id = $2
            WHERE payment_id = $1
            RETURNING payment_id, user_id
        `;
    const result = await ucrmPool.query(query, [id, userId]);

    if (result.rows.length > 0) {
      res.json({ message: 'User ID updated successfully', payment: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }
  } catch (err) {
    console.error('Error updating Payment User ID:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 4.5. Actualizar Method ID en Payment (Direct SQL Patch)
app.patch('/payments/:id/method', async (req, res) => {
  const { id } = req.params;
  const { methodId } = req.body;

  if (!methodId) {
    return res.status(400).json({ error: 'methodId is required' });
  }

  try {
    const query = `
            UPDATE ucrm.payment
            SET method_id = $2
            WHERE payment_id = $1
            RETURNING payment_id, method_id
        `;
    const result = await ucrmPool.query(query, [id, methodId]);

    if (result.rows.length > 0) {
      res.json({ message: 'Method ID updated successfully', payment: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }
  } catch (err) {
    console.error('Error updating Payment Method ID:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 5. Obtener Opciones de Custom Attribute (Enum)
app.get('/custom-attributes/:id/options', async (req, res) => {
  const { id } = req.params;
  try {
    /* 
      OPTIMIZED QUERY:
      Based on analysis, 'ucrm.custom_attribute_value' contains the unique defined options for enum attributes.
      Row count verification confirmed it holds only the definition rows (e.g. 4 rows for 4 choices),
      not client assignments.
    */
    const query = `
      SELECT DISTINCT value AS name, value AS id
      FROM ucrm.custom_attribute_value
      WHERE custom_attribute_id = $1
      ORDER BY value ASC
    `;
    const result = await ucrmPool.query(query, [id]);

    // Return simple array of names if that's what frontend expects, 
    // or objects. The PHP code previously mapped to simple array of names.
    // Let's return objects, easier to extend.
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching attribute options:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Cleanup process handling
process.on('SIGINT', async () => {
  console.log('Cerrando Puppeteer y saliendo...');
  if (globalBrowser) await globalBrowser.close();
  process.exit();
});

process.on('SIGTERM', async () => {
  console.log('Cerrando Puppeteer y saliendo...');
  if (globalBrowser) await globalBrowser.close();
  process.exit();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Puppeteer service listening on port ${PORT}`);
});
