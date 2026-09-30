# 대문 이미지 만들기: 원본 그림의 가운데 윗부분(시간표 + 인물 상반신)을 잘라
#   apps/web/public/og-image.png (링크 미리보기 1200x630)
#   apps/web/public/hero.png     (로그인 화면)
# 실행: powershell -File scripts/make-hero.ps1 [원본 경로]
param([string]$Source = "$PSScriptRoot/../apps/web/public/hero-source.png")

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $W = $src.Width; $H = $src.Height
  # 원본 1024x559 기준 x 240~900, y 40~385 영역 (비율로 환산해 다른 해상도에도 대응)
  $x = [int]($W * 240 / 1024); $y = [int]($H * 40 / 559)
  $w = [int]($W * 660 / 1024); $h = [int]($w / 1.905)
  if ($y + $h -gt $H) { $h = $H - $y }
  $crop = New-Object System.Drawing.Rectangle $x, $y, $w, $h

  function Save-Resized([int]$outW, [int]$outH, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap $outW, $outH
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $outW, $outH), $crop, [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "saved $path ($outW x $outH)"
  }

  $out = "$PSScriptRoot/../apps/web/public"
  Save-Resized 1200 630 "$out/og-image.png"
  Save-Resized 960 504 "$out/hero.png"
} finally {
  $src.Dispose()
}
