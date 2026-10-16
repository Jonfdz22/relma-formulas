@echo off
title RELMA - Sistema de Formulas
cd /d "%~dp0"
echo Iniciando RELMA...
echo.
echo NO CIERRES ESTA VENTANA mientras uses la aplicacion
echo.
start "" http://localhost:3000
node server.js
pause