import sys
import os

# Agregar el directorio parent al path para importar backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app import app

# Export para Vercel
__all__ = ['app']