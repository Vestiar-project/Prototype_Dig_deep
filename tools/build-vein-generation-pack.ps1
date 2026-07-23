param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\docs\art-packs\depth-zero-vein-connectors-generation-pack-v1.zip')
)

Add-Type -AssemblyName System.IO.Compression

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$absoluteOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($absoluteOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$files = [ordered]@{
  'PROMPT_RU.md' = 'docs\art-references\VEIN_CONNECTORS_IMAGE_PROMPT_RU.md'
  'NEGATIVE_PROMPT_RU.txt' = 'docs\art-references\VEIN_CONNECTORS_NEGATIVE_PROMPT_RU.txt'
  'manifest.json' = 'docs\art-references\vein-connectors-manifest.json'
  'references/01_ore_nodes_authoritative.png' = 'assets\field\depth-zero-ores-runtime-atlas.png'
  'references/02_terrain_authoritative.png' = 'assets\field\depth-zero-terrain-runtime-atlas.png'
  'references/03_topology_and_scale.png' = 'docs\art-references\vein-connectors-layout-guide.png'
}

if ([System.IO.File]::Exists($absoluteOutput)) {
  [System.IO.File]::Delete($absoluteOutput)
}

$fileStream = [System.IO.File]::Open($absoluteOutput, [System.IO.FileMode]::CreateNew)
$archive = [System.IO.Compression.ZipArchive]::new(
  $fileStream,
  [System.IO.Compression.ZipArchiveMode]::Create,
  $false,
  [System.Text.Encoding]::UTF8
)

try {
  foreach ($entryName in $files.Keys) {
    $sourcePath = [System.IO.Path]::Combine($root, $files[$entryName])
    if (-not [System.IO.File]::Exists($sourcePath)) {
      throw "Missing package source: $sourcePath"
    }
    $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $sourceStream = [System.IO.File]::OpenRead($sourcePath)
    try {
      $sourceStream.CopyTo($entryStream)
    } finally {
      $sourceStream.Dispose()
      $entryStream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
  $fileStream.Dispose()
}

Write-Output $absoluteOutput
