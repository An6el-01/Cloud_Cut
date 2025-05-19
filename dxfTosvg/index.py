import os
import sys
import ezdxf
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import io

def convert_dxf_to_svg(dxf_path):
    """
    Convert a DXF file to SVG format and return the SVG data.
    
    Args:
        dxf_path (str): Path to DXF file
    
    Returns:
        str: SVG data as string
    """
    if not dxf_path.endswith('.dxf'):
        print(f"Error: {dxf_path} is not a DXF file", file=sys.stderr)
        return None

    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
        
        # Create matplotlib figure
        fig = plt.figure()
        ax = fig.add_axes([0, 0, 1, 1])
        
        # Create rendering context
        ctx = RenderContext(doc)
        out = MatplotlibBackend(ax)
        Frontend(ctx, out).draw_layout(msp, finalize=True)
        
        # Save SVG to memory buffer instead of file
        buffer = io.BytesIO()
        fig.savefig(buffer, format='svg')
        buffer.seek(0)
        svg_data = buffer.getvalue().decode('utf-8')
        
        plt.close(fig)  # Close the figure to free memory
        print(f"Successfully converted: {dxf_path}", file=sys.stderr)
        return svg_data
        
    except Exception as e:
        print(f"Error converting {dxf_path}: {str(e)}", file=sys.stderr)
        return None

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python index.py <dxf_file>", file=sys.stderr)
        sys.exit(1)
    
    dxf_path = sys.argv[1]
    svg_data = convert_dxf_to_svg(dxf_path)
    
    if svg_data:
        print(svg_data)
        sys.exit(0)
    else:
        sys.exit(1)