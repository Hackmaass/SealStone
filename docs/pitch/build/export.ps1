$d = (Resolve-Path "Sealstone_Vortexa3_Deck.pptx").Path
$dir = Split-Path $d
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $p = $ppt.Presentations.Open($d, 0, 0, 0)   # read-write, no window
  "opened read-write: {0} slides" -f $p.Slides.Count
  $p.SaveCopyAs((Join-Path $dir "roundtrip.pptx"))
  $p.SaveAs((Join-Path $dir "Sealstone_Vortexa3_Deck.pdf"), 32)
  $p.Close()
  $q = $ppt.Presentations.Open((Join-Path $dir "roundtrip.pptx"), -1, 0, 0)
  "round-trip file reopened: {0} slides" -f $q.Slides.Count
  $q.Close()
} finally { $ppt.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) }
