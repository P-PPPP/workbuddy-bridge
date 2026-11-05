# 水分子 DFT 与静电势表面

这是一个通过 WorkBuddy-Link 将计算交给 WorkBuddy 的实测示例。计算使用 GLM-5.3-Flash、gaussian16-wsl 与 multiwfn 技能；Gaussian 和 Multiwfn 负责数值计算，VMD/Tachyon 生成表面图。

## 结果

- **体系：** 气相中性单重态 H₂O
- **计算：** B3LYP/def2TZVP，紧结构优化与谐振频率，SCF 使用 Tight/XQC，积分网格为 UltraFine
- **最终能量：** −76.4629956141 Hartree；fchk 独立读取结果为 −76.46299561409643 Hartree
- **结构：** O–H 键长 0.962706 Å，H–O–H 键角 105.24336°
- **偶极矩：** 2.0636 D
- **频率：** 1617.0143、3785.8927、3891.0965 cm⁻¹；无虚频
- **ESP 表面：** ρ = 0.001 e/bohr³；网格间距 0.20 bohr
- **表面 ESP 极值：** −0.05806658 至 +0.06795273 a.u.
- **表面积：** 45.65324 Å²
- **网格：** 密度与 ESP 均为 50 × 54 × 50，独立检查通过

## 工作状态与 token 记录

Gaussian 的优化和频率计算均正常结束，最终能量与格式化 checkpoint 一致。首次 WorkBuddy 任务触发连接器等待超时，任务状态保留为 unknown / ACP_TIMEOUT，不视为 WorkBuddy 已确认完成。后续整理会话在额外的只读日志访问请求处结束为 cancelled，没有重跑 DFT。最终图像和公开摘要由已有且独立核验的结果文件整理完成。

[workbuddy-usage.json](workbuddy-usage.json) 汇总了两段会话中原生日志报告的 35 次模型调用：输入 1,644,455、输出 19,717、合计 1,664,172 token，其中缓存读取 1,461,760。缓存是输入细分项，不额外累加到总量。该记录不是账单；未报告或失败调用可能不在统计内。

完整机器可读结果见 [summary.json](summary.json)，英文说明见 [README.md](README.md)。Gaussian 与 Multiwfn 的安装、授权以及对应技能需要用户自行配置。
