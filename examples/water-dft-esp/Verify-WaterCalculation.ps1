param(
 [Parameter(Mandatory=$true)][string]$CalculationDirectory,
 [string]$OutputPath
)
$ErrorActionPreference='Stop'
$culture=[Globalization.CultureInfo]::InvariantCulture
function Num([string]$s){[double]::Parse($s.Replace('D','E'),$culture)}
function Distance($a,$b){[Math]::Sqrt([Math]::Pow($a.x-$b.x,2)+[Math]::Pow($a.y-$b.y,2)+[Math]::Pow($a.z-$b.z,2))}
$logPath=Join-Path $CalculationDirectory 'water.log'
if(!(Test-Path -LiteralPath $logPath)){$logPath=Join-Path $CalculationDirectory 'gaussian-output.txt'}
$text=[IO.File]::ReadAllText($logPath)
$energies=[regex]::Matches($text,'SCF Done:\s+E\(RB3LYP\)\s*=\s*([-0-9.]+)')
if(!$energies.Count){throw 'No RB3LYP energy found.'}
$energy=Num $energies[$energies.Count-1].Groups[1].Value
$coordinates=@();$candidate=@();$reading=$false
foreach($line in $text -split '\r?\n'){
 if($line -match 'Standard orientation:'){$reading=$true;$candidate=@();continue}
 if(!$reading){continue}
 $m=[regex]::Match($line,'^\s+\d+\s+(\d+)\s+\d+\s+([-0-9.]+)\s+([-0-9.]+)\s+([-0-9.]+)\s*$')
 if($m.Success){$candidate+=@{atomic_number=[int]$m.Groups[1].Value;x=(Num $m.Groups[2].Value);y=(Num $m.Groups[3].Value);z=(Num $m.Groups[4].Value)}}
 elseif($line -match '^\s*-+\s*$' -and $candidate.Count){$coordinates=$candidate;$reading=$false}
}
if($coordinates.Count -ne 3){throw 'Expected three optimized atoms.'}
$oxygen=@($coordinates|Where-Object atomic_number -eq 8)
$hydrogens=@($coordinates|Where-Object atomic_number -eq 1)
if($oxygen.Count -ne 1 -or $hydrogens.Count -ne 2){throw 'Not H2O.'}
$o=$oxygen[0];$h1=$hydrogens[0];$h2=$hydrogens[1]
$b1=Distance $o $h1;$b2=Distance $o $h2
$dot=($h1.x-$o.x)*($h2.x-$o.x)+($h1.y-$o.y)*($h2.y-$o.y)+($h1.z-$o.z)*($h2.z-$o.z)
$angle=[Math]::Acos($dot/($b1*$b2))*180/[Math]::PI
$freq=@(foreach($m in [regex]::Matches($text,'Frequencies --\s+([^\r\n]+)')){foreach($v in $m.Groups[1].Value.Trim() -split '\s+'){Num $v}})
$dipoles=[regex]::Matches($text,'Dipole moment \(field-independent basis, Debye\):\s*\r?\n\s*X=\s*([-0-9.]+)\s+Y=\s*([-0-9.]+)\s+Z=\s*([-0-9.]+)\s+Tot=\s*([-0-9.]+)')
if(!$dipoles.Count){throw 'Dipole not found.'}
$dipole=Num $dipoles[$dipoles.Count-1].Groups[4].Value
$fchk=[IO.File]::ReadAllText((Join-Path $CalculationDirectory 'water.fchk'))
$fm=[regex]::Match($fchk,'(?m)^Total Energy\s+R\s+([-+0-9.EeDd]+)')
if(!$fm.Success){throw 'FCHK total energy missing.'}
$fenergy=Num $fm.Groups[1].Value
$normal=[regex]::Matches($text,'Normal termination of Gaussian 16').Count
$errors=[regex]::Matches($text,'Error termination').Count
$optimized=[regex]::Matches($text,'Optimization completed\.').Count
$convergence=@([regex]::Matches($text,'(?m)^\s*(Maximum Force|RMS\s+Force|Maximum Displacement|RMS\s+Displacement)\s+([-0-9.]+)\s+([-0-9.]+)\s+(YES|NO)\s*$')|Select-Object -Last 4|ForEach-Object {@{criterion=$_.Groups[1].Value;value=(Num $_.Groups[2].Value);threshold=(Num $_.Groups[3].Value);converged=($_.Groups[4].Value -eq 'YES')}})
$passed=$normal -ge 2 -and $errors -eq 0 -and $optimized -ge 1 -and $freq.Count -eq 3 -and @($freq|Where-Object {$_ -le 0}).Count -eq 0 -and [Math]::Abs($energy-$fenergy) -lt 1e-8 -and $convergence.Count -eq 4 -and @($convergence|Where-Object {!$_.converged}).Count -eq 0
$result=[ordered]@{source='Independent read-only extraction from Gaussian output and formatted checkpoint';passed=$passed;normal_terminations=$normal;error_terminations=$errors;optimization_completed=$optimized;final_scf_energy_hartree=$energy;fchk_total_energy_hartree=$fenergy;coordinates_angstrom=$coordinates;oh_bond_lengths_angstrom=@($b1,$b2);hoh_angle_degrees=$angle;dipole_debye=$dipole;harmonic_frequencies_cm_minus_1=$freq;imaginary_frequency_count=@($freq|Where-Object {$_ -lt 0}).Count;final_convergence=$convergence;sha256=@{gaussian_output=(Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLower();formatted_checkpoint=(Get-FileHash -LiteralPath (Join-Path $CalculationDirectory 'water.fchk') -Algorithm SHA256).Hash.ToLower()}}
$json=$result|ConvertTo-Json -Depth 10
if($OutputPath){[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath),$json+"`n",[Text.UTF8Encoding]::new($false))}
$json
if(!$passed){exit 1}
