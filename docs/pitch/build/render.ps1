# Renders every slide of a .pptx to PNG using the real PowerPoint (no window). Usage: render.ps1 <deck.pptx> <outDir> [width]
param([Parameter(Mandatory)][string]$Deck, [Parameter(Mandatory)][string]$Out, [int]$Width = 1600)
$ErrorActionPreference = "Stop"
$Deck = (Resolve-Path $Deck).Path
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Get-ChildItem $Out -Filter "Slide*.PNG" -ErrorAction SilentlyContinue | Remove-Item -Force
$ppt = $null
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  # ReadOnly, no title, no window: nothing to click on a locked screen
  $pres = $ppt.Presentations.Open($Deck, -1, 0, 0)
  $w = $pres.PageSetup.SlideWidth; $h = $pres.PageSetup.SlideHeight
  $height = [int]([math]::Round($Width * $h / $w))
  $pres.Export($Out, "PNG", $Width, $height)
  "slides: {0}  size: {1}x{2} px  -> {3}" -f $pres.Slides.Count, $Width, $height, $Out
  $pres.Close()
} finally {
  if ($ppt) { $ppt.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) }
}
