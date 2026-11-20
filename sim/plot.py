# sim/out/results.json → sim/out/figure.png  (실행: python3 sim/plot.py)
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

for f in font_manager.findSystemFonts():
    if "NotoSansCJK" in f or "NanumGothic" in f:
        font_manager.fontManager.addfont(f)
plt.rcParams["font.family"] = "Noto Sans CJK JP"
plt.rcParams["axes.unicode_minus"] = False

r = json.load(open("sim/out/results.json", encoding="utf-8"))
NAVY, PURPLE, GOLD, GRAY = "#1F2937", "#0F766E", "#D97706", "#CBD5E1"   # 진한 회색 · 청록 · 주황 · 연회색

fig, ax = plt.subplots(1, 3, figsize=(15, 4.6))
fig.suptitle(f"StageOn AI 시뮬레이션 (가상 참가자 {r['participants']}명 · 실제 사람 데이터 아님)", fontsize=14, color=NAVY)

a = r["experimentA"]
vals = [a["meanHR"]["practice"], a["meanHR"]["vr"], a["meanHR"]["real"]]
ax[0].bar(["혼자 연습실", "StageOn VR", "실제 관객 앞"], vals, color=[GRAY, PURPLE, NAVY])
ax[0].set_ylim(min(vals) - 10, max(vals) + 8)
for i, v in enumerate(vals):
    ax[0].text(i, v + 1, f"{v:.0f}", ha="center", color=NAVY)
ax[0].set_title(f"A. 불안 재현율 평균 {a['reproductionRatePct']['mean']:.0f}%", color=NAVY)
ax[0].set_ylabel("연주 중 평균 심박 (bpm)")

b = sorted(r["experimentB"], key=lambda x: -x["meanDropPct"])
ax[1].barh([x["name"] for x in b][::-1], [x["meanDropPct"] for x in b][::-1], color=PURPLE)
for i, x in enumerate(b[::-1]):
    ax[1].text(x["meanDropPct"] + 0.1, i, f"{x['meanDropPct']:.1f}", va="center", color=NAVY)
ax[1].set_title("B. 단서를 끄면 줄어드는 심박 증가 (%p)", color=NAVY)

c = r["experimentC"]
ax[2].plot([x["session"] for x in c], [x["meanRatioPct"] for x in c], marker="o", color=GOLD, linewidth=2.5)
ax[2].axhspan(20, 40, color=PURPLE, alpha=0.1)
ax[2].text(1.02, 38.5, "목표 구간 +20–40%", color=PURPLE, fontsize=9)
for x in c:
    ax[2].text(x["session"], x["meanRatioPct"] + 0.8, f"+{x['meanRatioPct']:.1f}%", ha="center", color=NAVY)
ax[2].set_xticks([1, 2, 3], ["1회", "2회", "3회"])
ax[2].set_ylim(10, 42)
ax[2].set_title("C. 반복할수록 줄어드는 심박 증가 (적응)", color=NAVY)
ax[2].set_ylabel("기준선 대비 평균 심박 증가 (%)")

for x in ax:
    x.spines[["top", "right"]].set_visible(False)
fig.tight_layout(rect=[0, 0, 1, 0.93])
fig.savefig("sim/out/figure.png", dpi=150)
print("sim/out/figure.png")
