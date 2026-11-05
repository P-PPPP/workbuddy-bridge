param(
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$MultiwfnDirectory='C:\Multiwfn',
 [string]$VmdDirectory='C:\Program Files (x86)\University of Illinois\VMD',
 [switch]$FromSavedGrids
)
$ErrorActionPreference='Stop'
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $output){throw 'Choose a new output directory; existing files will not be replaced.'}
$render=Join-Path $output 'render'
New-Item -ItemType Directory -Path $render -Force|Out-Null
function Run-Native([string]$Exe,[string[]]$Arguments,[string]$Directory,[string]$Log,[string]$InputFile){
 $options=@{FilePath=$Exe;ArgumentList=$Arguments;WorkingDirectory=$Directory;RedirectStandardOutput=(Join-Path $Directory ($Log+'.txt'));RedirectStandardError=(Join-Path $Directory ($Log+'-stderr.txt'));WindowStyle='Hidden';Wait=$true;PassThru=$true}
 if($InputFile){$options.RedirectStandardInput=$InputFile}
 $p=Start-Process @options
 if($p.ExitCode -ne 0){throw "$Log failed (exit $($p.ExitCode)); inspect its output."}
}
if($FromSavedGrids){
 Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'water-grids.zip') -DestinationPath $output
}else{
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'water.fchk') -Destination $output
 $previous=$env:Multiwfnpath
 try{
  $env:Multiwfnpath=$MultiwfnDirectory
  Run-Native (Join-Path $MultiwfnDirectory 'Multiwfn.exe') @('water.fchk','-nt','4','-silent') $output 'multiwfn-output' (Join-Path $PSScriptRoot 'multiwfn-input.txt')
 }finally{$env:Multiwfnpath=$previous}
}
Copy-Item -LiteralPath (Join-Path $output 'surf.cub') -Destination (Join-Path $render 'water_density.cub')
Copy-Item -LiteralPath (Join-Path $output 'mapfunc.cub') -Destination (Join-Path $render 'water_esp.cub')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'render_esp.vmd'),(Join-Path $PSScriptRoot 'render_mol.vmd') -Destination $render
$vmd=Join-Path $VmdDirectory 'vmd.exe'
$tachyon=Join-Path $VmdDirectory 'tachyon_WIN32.exe'
Run-Native $vmd @('-dispdev','text','-e','render_esp.vmd') $render 'vmd-esp' ''
Run-Native $tachyon @('water-esp-scene.dat','-format','TGA','-o','water-esp.tga') $render 'tachyon-esp' ''
Run-Native $vmd @('-dispdev','text','-e','render_mol.vmd') $render 'vmd-molecule' ''
Run-Native $tachyon @('mol-preview-scene.dat','-format','TGA','-o','mol-preview.tga') $render 'tachyon-molecule' ''
Push-Location $output
try{
 & uv run --with pillow python (Join-Path $PSScriptRoot 'compose_esp.py') 'render/water-esp.tga' 'render/mol-preview.tga'
 if($LASTEXITCODE -ne 0){throw 'PNG composition failed.'}
}finally{Pop-Location}
Write-Output (Join-Path $output 'water-esp.png')
