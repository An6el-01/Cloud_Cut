import os
import ezdxf
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import io

def convert_dxf_to_svg(dxf_files):
    """
    Convert a list of DXF files to SVG format and return the SVG data.
    
    Args:
        dxf_files (list): List of paths to DXF files
    
    Returns:
        dict: Dictionary mapping original filenames to their SVG data
    """
    converted_files = {}
    
    for dxf_path in dxf_files:
        if not dxf_path.endswith('.dxf'):
            print(f"Skipping {dxf_path}: Not a DXF file")
            continue

        filename = os.path.basename(dxf_path)
        svg_filename = filename.replace('.dxf', '.svg')

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
            
            # Store the SVG data
            converted_files[svg_filename] = svg_data
            
            plt.close(fig)  # Close the figure to free memory
            print(f"Converted: {filename} => {svg_filename}")
            
        except Exception as e:
            print(f"Failed to convert {filename}: {str(e)}")
    
    return converted_files
