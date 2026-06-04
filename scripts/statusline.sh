#!/bin/bash
input=$(cat)

parsed=$(echo "$input" | node -e "
let raw='';
process.stdin.on('data',c=>raw+=c);
process.stdin.on('end',()=>{
  const d=JSON.parse(raw);
  const cwd=d.workspace?.current_dir||d.cwd||'';
  const model=d.model?.display_name||'';
  const pct=d.context_window?.used_percentage??'';
  const fivePct=d.rate_limits?.five_hour?.used_percentage??'';
  const fiveReset=d.rate_limits?.five_hour?.resets_at??'';
  const sevenPct=d.rate_limits?.seven_day?.used_percentage??'';
  const sevenReset=d.rate_limits?.seven_day?.resets_at??'';
  console.log([cwd,model,pct,fivePct,fiveReset,sevenPct,sevenReset].join('\n'));
});
")

cwd=$(echo "$parsed" | sed -n '1p')
model=$(echo "$parsed" | sed -n '2p')
used_pct=$(echo "$parsed" | sed -n '3p')
five_pct=$(echo "$parsed" | sed -n '4p')
five_reset=$(echo "$parsed" | sed -n '5p')
seven_pct=$(echo "$parsed" | sed -n '6p')
seven_reset=$(echo "$parsed" | sed -n '7p')

# Shorten home directory to ~
home_dir="$HOME"
if [ -n "$home_dir" ] && [[ "$cwd" == "$home_dir"* ]]; then
  cwd="~${cwd#$home_dir}"
fi

# Get git branch
git_branch=""
if git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
fi

# Gradient RGB for a fraction 0..1: green -> yellow -> red
grad_rgb() {
  # prints "R;G;B"
  awk -v f="$1" 'BEGIN{
    if(f<0)f=0; if(f>1)f=1;
    m=170;
    if(f<0.5){ r=int(2*m*f); g=m } else { r=m; g=int(m-2*m*(f-0.5)) }
    if(r<0)r=0; if(r>m)r=m; if(g<0)g=0; if(g>m)g=m;
    printf "%d;%d;%d", r, g, 0
  }'
}

# Build a gradient progress bar (green->red per cell): make_bar <pct_int> <width>
# Each cell = 1 tranche (with width=10, one cell per 10%).
make_bar() {
  local pct=$1 width=$2
  local filled=$(( pct * width / 100 ))
  [ "$filled" -gt "$width" ] && filled=$width
  local bar="" i denom=$(( width - 1 ))
  [ "$denom" -lt 1 ] && denom=1
  for ((i=0; i<filled; i++)); do
    local frac
    frac=$(awk -v i="$i" -v d="$denom" 'BEGIN{printf "%.4f", i/d}')
    bar="${bar}$(printf '\033[38;2;%sm█' "$(grad_rgb "$frac")")"
  done
  # empty cells dim gray
  for ((i=filled; i<width; i++)); do bar="${bar}$(printf '\033[38;2;60;60;60m░')"; done
  printf '%s\033[0m' "$bar"
}

# Format a reset timestamp as "10pm" or "Apr18"
fmt_reset() {
  local ts=$1 force_time=$2
  [ -z "$ts" ] && return
  node -e "
    const d=new Date($ts*1000);
    const now=new Date();
    const sameDay=d.toDateString()===now.toDateString() || '$force_time'==='time';
    if(sameDay){
      const h=d.getHours(); const ampm=h>=12?'pm':'am'; const h12=h%12||12;
      process.stdout.write(h12+ampm);
    } else {
      const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      process.stdout.write(months[d.getMonth()]+d.getDate());
    }
  "
}

# Build output
parts=()

# Current directory
[ -n "$cwd" ] && parts+=("$(printf '\033[34m%s\033[0m' "$cwd")")

# Git branch
[ -n "$git_branch" ] && parts+=("$(printf '\033[32m(%s)\033[0m' "$git_branch")")

# Model name
[ -n "$model" ] && parts+=("$(printf '\033[33m%s\033[0m' "$model")")

# Usage indicators: 10-cell gradient bars (green->red), 1 cell per 10%.
# Layout: ctx:██░░░░░░░░ | →10pm:█░░░░░░░░░ | →Apr18:░░░░░░░░░░
#   ctx = context window used; →<reset> = 5h then 7d rate-limit windows,
#   each prefixed by when that window resets.
BAR_W=10
usage_parts=()
if [ -n "$used_pct" ]; then
  used_int=$(printf '%.0f' "$used_pct")
  usage_parts+=("$(printf 'ctx:%s' "$(make_bar "$used_int" "$BAR_W")")")
fi
if [ -n "$five_pct" ]; then
  pct_int=$(printf '%.0f' "$five_pct")
  reset_str=$(fmt_reset "$five_reset" time)
  usage_parts+=("$(printf '%s:%s' "${reset_str:+→$reset_str}" "$(make_bar "$pct_int" "$BAR_W")")")
fi
if [ -n "$seven_pct" ]; then
  pct_int=$(printf '%.0f' "$seven_pct")
  reset_str=$(fmt_reset "$seven_reset")
  usage_parts+=("$(printf '%s:%s' "${reset_str:+→$reset_str}" "$(make_bar "$pct_int" "$BAR_W")")")
fi
[ ${#usage_parts[@]} -gt 0 ] && parts+=("$(printf '%s' "$(IFS='|'; set -- "${usage_parts[@]}"; out=$1; shift; for p in "$@"; do out="$out | $p"; done; printf '%s' "$out")")")

# Join parts with separator
printf '%s' "$(IFS=' | '; echo "${parts[*]}")"
