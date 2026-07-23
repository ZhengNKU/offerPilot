"""
内容审核预览接口

前端可选接入 `POST /api/moderation/preview` 做实时 hint:
- 输入框 onBlur 调一次,返回 Pass / Review / Block
- UI 根据结果在输入框下方显示红字提示
- **不影响**最终提交审核(后端 @moderated 才是事实上的防线)

注意:
- preview 接口**不写审计**(audit=False),高频调用不污染审计表
- 走 `moderate_text` 同一份逻辑,但返回结构化 JSON(不是 raise 400)
- 用户匿名可调(无 token 也能用,仅失去 user_id 关联)
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import models
from app.routers.auth import get_current_user_optional
from app.utils.content_moderation import moderate_text

router = APIRouter(prefix="/api/moderation", tags=["Moderation"])


class PreviewRequest(BaseModel):
    text: str = Field(..., max_length=2000, description="待审核文本")
    scene: str = Field(default="preview", description="业务场景标识,审计场景串")


class PreviewResponse(BaseModel):
    suggestion: str           # Pass / Review / Block
    label: str                # Normal / Porn / Abuse / Ad / ...
    sub_label: str
    score: int
    keywords_count: int       # 命中关键词数(不返回明文,前端 hint 只需要知道"有命中")
    message: str              # UI 友好提示:"✓ 内容合规" / "⚠ 包含敏感词" / "✗ 内容违规"


@router.post("/preview", response_model=PreviewResponse)
async def preview(
    req: PreviewRequest,
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """
    对单段文本做内容审核(同步阻塞,~300-800ms),返回结构化结果。

    用途:
    - 前端输入框 onBlur hint
    - 运营/客服"先看看"工具

    失败处理:同 moderate_text,服务不可用时按 CONTENT_MODERATION_FAIL_OPEN 决定行为。
    """
    uid = current_user.id if current_user else None
    result = await moderate_text(req.text, uid, scene=req.scene, audit=False)

    msg_map = {
        "Pass": "✓ 内容合规",
        "Review": "⚠ 包含敏感词,请修改",
        "Block": "✗ 内容违规,无法发布",
    }
    message = msg_map.get(result.suggestion, "")

    return PreviewResponse(
        suggestion=result.suggestion,
        label=result.label,
        sub_label=result.sub_label,
        score=result.score,
        keywords_count=len(result.keywords),
        message=message,
    )
