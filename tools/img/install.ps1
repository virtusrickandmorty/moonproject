<#
  Installs the IMG image tools on the shop PC, beside the database: <data>\tools\realesrgan and <data>\tools\rembg.
  Run once from the repository folder:  powershell -ExecutionPolicy Bypass -File tools\img\install.ps1 -Data C:\moonproject\data
  Needs Python 3.10+ and the internet (about 1.3 GB: the upscaler, the background remover and its two models).
  Running it again repairs or updates; nothing in the database is touched.
#>
param([Parameter(Mandatory = $true)][string]$Data)
$ErrorActionPreference = 'Stop'
$tools = Join-Path $Data 'tools'
New-Item -ItemType Directory -Force $tools | Out-Null

# 1. The upscaler: Real-ESRGAN (BSD-3-Clause), the portable build that runs on the graphics card through Vulkan.
$esr = Join-Path $tools 'realesrgan'
if (-not (Test-Path (Join-Path $esr 'realesrgan-ncnn-vulkan.exe'))) {
  $zip = Join-Path $env:TEMP 'realesrgan-ncnn-vulkan.zip'
  Write-Host 'Downloading the upscaler (45 MB)...'
  Invoke-WebRequest 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip' -OutFile $zip
  Expand-Archive $zip -DestinationPath $esr -Force
  Remove-Item $zip
}

# 2. The background remover: rembg in its own Python environment, on the graphics card through DirectML.
$bg = Join-Path $tools 'rembg'
New-Item -ItemType Directory -Force $bg | Out-Null
$py = Join-Path $bg 'env\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host 'Making the background remover''s Python environment...'
  python -m venv (Join-Path $bg 'env')
}
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet 'rembg[cli]==2.0.85' 'onnxruntime-directml==1.24.4'
Copy-Item (Join-Path $PSScriptRoot 'remove.py') (Join-Path $bg 'remove.py') -Force

# 3. Fetch both models now (about 1.15 GB), so the first use is not a long wait: a 1x1 picture through each.
$probe = Join-Path $env:TEMP 'img-probe.png'
& $py -c "from PIL import Image; Image.new('RGB',(8,8),(255,255,255)).save(r'$probe')"
foreach ($kind in 'design', 'object') {
  Write-Host "Fetching the $kind model..."
  & $py (Join-Path $bg 'remove.py') $probe "$probe.out.png" $kind
}
Remove-Item $probe, "$probe.out.png" -ErrorAction SilentlyContinue
Write-Host "Image tools installed in $tools. Restart the Moonproject server to use them."
