from http.server import BaseHTTPRequestHandler
import json
import ezdxf
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import io
import base64
import traceback

def convert_dxf_to_svg(dxf_data):
    try:
        # Create a BytesIO object from the base64 data
        dxf_buffer = io.BytesIO(base64.b64decode(dxf_data))
        
        # Read the DXF file
        doc = ezdxf.readfile(dxf_buffer)
        msp = doc.modelspace()
        
        # Create matplotlib figure
        fig = plt.figure(figsize=(10, 10))
        ax = fig.add_axes([0, 0, 1, 1])
        
        # Create rendering context
        ctx = RenderContext(doc)
        out = MatplotlibBackend(ax)
        Frontend(ctx, out).draw_layout(msp, finalize=True)
        
        # Save SVG to memory buffer
        buffer = io.BytesIO()
        fig.savefig(buffer, format='svg', bbox_inches='tight', pad_inches=0)
        buffer.seek(0)
        svg_data = buffer.getvalue().decode('utf-8')
        
        plt.close(fig)  # Close the figure to free memory
        
        if not svg_data or not svg_data.strip().startswith('<?xml'):
            return {
                'success': False,
                'error': 'Generated SVG is invalid or empty'
            }
        
        return {
            'success': True,
            'svg': svg_data
        }
    except Exception as e:
        error_details = traceback.format_exc()
        return {
            'success': False,
            'error': f'Conversion error: {str(e)}\n{error_details}'
        }

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Get the content length
            content_length = int(self.headers['Content-Length'])
            
            # Read the request body
            post_data = self.rfile.read(content_length)
            
            # Parse the JSON data
            data = json.loads(post_data.decode('utf-8'))
            
            # Get the DXF data
            dxf_data = data.get('dxf')
            
            if not dxf_data:
                self.send_error(400, 'No DXF data provided')
                return
            
            # Convert DXF to SVG
            result = convert_dxf_to_svg(dxf_data)
            
            # Send the response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            self.wfile.write(json.dumps(result).encode())
            
        except json.JSONDecodeError:
            self.send_error(400, 'Invalid JSON data')
        except Exception as e:
            error_details = traceback.format_exc()
            self.send_error(500, f'Server error: {str(e)}\n{error_details}')
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers() 