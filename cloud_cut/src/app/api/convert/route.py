from http.server import BaseHTTPRequestHandler
import json
import ezdxf
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import io
import base64

def convert_dxf_to_svg(dxf_data):
    try:
        # Create a BytesIO object from the base64 data
        dxf_buffer = io.BytesIO(base64.b64decode(dxf_data))
        
        # Read the DXF file
        doc = ezdxf.readfile(dxf_buffer)
        msp = doc.modelspace()
        
        # Create matplotlib figure
        fig = plt.figure()
        ax = fig.add_axes([0, 0, 1, 1])
        
        # Create rendering context
        ctx = RenderContext(doc)
        out = MatplotlibBackend(ax)
        Frontend(ctx, out).draw_layout(msp, finalize=True)
        
        # Save SVG to memory buffer
        buffer = io.BytesIO()
        fig.savefig(buffer, format='svg')
        buffer.seek(0)
        svg_data = buffer.getvalue().decode('utf-8')
        
        plt.close(fig)  # Close the figure to free memory
        
        return {
            'success': True,
            'svg': svg_data
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
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
            self.end_headers()
            
            self.wfile.write(json.dumps(result).encode())
            
        except Exception as e:
            self.send_error(500, str(e)) 