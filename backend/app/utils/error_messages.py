"""
统一的"分析失败"报错文案 —— 给前端展示用。

2026-07-25+ 设计原则:
  - 所有"分析"类功能失败的报错,统一为 "X分析失败: 原因" 格式
  - 前缀固定(录音/记录/简历/模拟面试/AI 职业顾问),方便前端统一处理 + 用户一眼能看懂
  - reason 短而具体,避免堆栈信息;完整堆栈在 server 日志里
  - 不要再用 "请稍后重试" "大模型诊断任务失败" 等通用兜底文案
"""
from __future__ import annotations


# 功能名(显示给用户)
FEATURE_AUDIO   = "录音分析"
FEATURE_RECORD  = "记录分析"
FEATURE_RESUME  = "简历分析"
FEATURE_LIVE    = "模拟面试"
FEATURE_COUNSEL = "AI 职业顾问"


def format_failure(feature: str, reason: str) -> str:
    """
    统一格式: "{功能名}分析失败：{具体原因}"

    示例:
        format_failure(FEATURE_AUDIO, "ASR 调用超时")
        -> "录音分析失败：ASR 调用超时"

        format_failure(FEATURE_RESUME, "大模型返回 JSON 解析失败")
        -> "简历分析失败：大模型返回 JSON 解析失败"
    """
    reason = (reason or "").strip() or "未知原因"
    return f"{feature}失败：{reason}"


# 常见 reason 文案(集中维护,避免散落各文件拼写不一致)
REASON_ASR_DOWNLOAD_FAILED     = "音频下载失败"
REASON_ASR_INVALID_URI         = "音频无法识别(Invalid audio URI)"
REASON_ASR_NO_SPEECH           = "音频无有效语音内容"
REASON_LLM_TIMEOUT             = "AI 响应超时"
REASON_LLM_EMPTY               = "AI 返回为空"
REASON_LLM_JSON_PARSE          = "AI 返回 JSON 解析失败"
REASON_LLM_MISSING_FIELD       = "AI 返回缺少关键字段"
REASON_COS_DOWNLOAD_FAILED     = "云存储文件下载失败"
REASON_COS_PRESIGN_FAILED      = "生成预签名 URL 失败"
REASON_FILE_PARSE_FAILED       = "文件解析失败"
REASON_FILE_EMPTY              = "文件无可用内容"
REASON_DB_NOT_FOUND            = "记录不存在"
REASON_DB_PERSIST_FAILED       = "结果保存失败"
REASON_QUOTA_EXHAUSTED         = "本次分析已完成但额度不足,本次不计入消耗"
REASON_UNKNOWN                 = "未知原因"
