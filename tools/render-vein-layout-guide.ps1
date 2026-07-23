param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\docs\art-references\vein-connectors-layout-guide.png')
)

Add-Type -AssemblyName System.Drawing

$width = 2000
$height = 800
$cellSize = 400
$bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 10, 20, 25))

$gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(50, 70, 104, 112), 1)
for ($x = 0; $x -lt $width; $x += 20) { $graphics.DrawLine($gridPen, $x, 0, $x, $height) }
for ($y = 0; $y -lt $height; $y += 20) { $graphics.DrawLine($gridPen, 0, $y, $width, $y) }

$borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 107, 139, 140), 3)
$outlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 17, 24, 27), 66)
$outlinePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
$outlinePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Flat
$guidePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 245, 208, 111), 3)
$guidePen.DashPattern = [single[]](12, 9)
$labelFont = [System.Drawing.Font]::new('Consolas', 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$coverFont = [System.Drawing.Font]::new('Consolas', 14, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$labelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 215, 231, 223))
$coverBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 208, 111))
$coverFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(190, 10, 20, 25))
$centerFormat = [System.Drawing.StringFormat]::new()
$centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
$centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Center

$cells = @(
  @{ Id = 'copper'; Color = '#C86B43'; Width = 46 },
  @{ Id = 'coal'; Color = '#302E36'; Width = 58 },
  @{ Id = 'iron'; Color = '#978E8B'; Width = 52 },
  @{ Id = 'amber'; Color = '#ED8A24'; Width = 42 },
  @{ Id = 'silver'; Color = '#D4E0EB'; Width = 28 },
  @{ Id = 'gold'; Color = '#F0AF27'; Width = 52 },
  @{ Id = 'amethyst'; Color = '#9A4CE0'; Width = 46 },
  @{ Id = 'prism_crystal'; Color = '#42CFE2'; Width = 46 },
  @{ Id = 'void_ore'; Color = '#6629BF'; Width = 60 },
  @{ Id = 'star_core'; Color = '#F16245'; Width = 52 }
)

for ($index = 0; $index -lt $cells.Count; $index += 1) {
  $column = $index % 5
  $row = [math]::Floor($index / 5)
  $left = $column * $cellSize
  $top = $row * $cellSize
  $centerX = $left + 200
  $centerY = $top + 200
  $graphics.DrawRectangle($borderPen, $left + 2, $top + 2, 396, 396)
  $graphics.DrawLine($outlinePen, $left, $centerY, $left + $cellSize, $centerY)
  $graphics.DrawLine($outlinePen, $centerX, $top, $centerX, $top + $cellSize)
  $materialPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($cells[$index].Color), $cells[$index].Width)
  $materialPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
  $materialPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Flat
  $graphics.DrawLine($materialPen, $left, $centerY, $left + $cellSize, $centerY)
  $graphics.DrawLine($materialPen, $centerX, $top, $centerX, $top + $cellSize)
  $materialPen.Dispose()
  $graphics.FillEllipse($coverFill, $centerX - 88, $centerY - 88, 176, 176)
  $graphics.DrawEllipse($guidePen, $centerX - 88, $centerY - 88, 176, 176)
  $graphics.DrawString($cells[$index].Id, $labelFont, $labelBrush, [System.Drawing.RectangleF]::new($left, $top + 8, 400, 28), $centerFormat)
  $graphics.DrawString('NODE COVER', $coverFont, $coverBrush, [System.Drawing.RectangleF]::new($centerX - 80, $centerY - 12, 160, 24), $centerFormat)
}

$absoluteOutput = [System.IO.Path]::GetFullPath($OutputPath)
$bitmap.Save($absoluteOutput, [System.Drawing.Imaging.ImageFormat]::Png)

$centerFormat.Dispose()
$coverFill.Dispose()
$coverBrush.Dispose()
$labelBrush.Dispose()
$coverFont.Dispose()
$labelFont.Dispose()
$guidePen.Dispose()
$outlinePen.Dispose()
$borderPen.Dispose()
$gridPen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $absoluteOutput
