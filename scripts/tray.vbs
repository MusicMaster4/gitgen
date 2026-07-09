' Sobe a bandeja do Git Command Generator SEM nenhuma janela visivel.
' O segundo argumento do Run (0) esconde tudo; o terceiro (False) nao espera.
Option Explicit
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & dir & "tray.ps1""", 0, False
