from fastapi import FastAPI, UploadFile, File, Form
from pdf2image import convert_from_bytes
from PIL import Image, ImageDraw, ImageFont
import io

app = FastAPI()

@app.post("/process")
async def process_pdf(
    file: UploadFile = File(...),
    mode: str = Form("full"), 
    x: int = Form(0),
    y: int = Form(0),
    w: int = Form(0),
    h: int = Form(0),
    overlay_text: str = Form(""),
    overlay_x: int = Form(0),
    overlay_y: int = Form(0),
    overlay_w: int = Form(0),
    overlay_h: int = Form(0)
):
    # 1. Leer PDF
    pdf_bytes = await file.read()
    try:
        images = convert_from_bytes(pdf_bytes, fmt="jpeg")
    except Exception as e:
        return {"error": f"Error leyendo PDF: {str(e)}"}
    
    if not images:
        return {"error": "No se pudo leer el PDF"}
    
    img = images[0]

    # 2. Logic de Overlay (Reemplazo de Texto)
    if overlay_text and overlay_w > 0 and overlay_h > 0:
        draw = ImageDraw.Draw(img)
        
        # Coordenadas del "parche" blanco (mask)
        # Asumimos que x,y es la esquina superior izquierda donde estaba el texto viejo
        draw.rectangle(
            [(overlay_x, overlay_y), (overlay_x + overlay_w, overlay_y + overlay_h)],
            fill="white",
            outline=None
        )
        
        # Escribir nuevo texto
        try:
            # Intentar cargar fuente estándar
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        except:
            font = ImageFont.load_default()
        
        # Escribir texto (centrado verticalmente en el parche o alineado a izquierda)
        # Alineado a la izquierda + padding de 5px
        draw.text((overlay_x, overlay_y + 2), overlay_text, fill="black", font=font)


    # 3. Lógica de recorte/ajuste (Posterior al overlay)
    if mode == "square":
        width, height = img.size
        max_dim = max(width, height)
        new_img = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
        paste_x = (max_dim - width) // 2
        paste_y = (max_dim - height) // 2
        new_img.paste(img, (paste_x, paste_y))
        img = new_img
        if w > 0 and h > 0: img = img.resize((w, h), Image.Resampling.LANCZOS)
        
    elif mode == "coords":
        img = img.crop((x, y, x + w, y + h))
        
    elif mode == "full":
         if w > 0 and h > 0:
             img = img.resize((w, h), Image.Resampling.LANCZOS)
         elif w > 0:
             aspect = img.height / img.width
             new_h = int(w * aspect)
             img = img.resize((w, new_h), Image.Resampling.LANCZOS)

    # 4. Return
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG', quality=95)
    img_byte_arr.seek(0)
    
    from starlette.responses import StreamingResponse
    return StreamingResponse(img_byte_arr, media_type="image/jpeg")
