from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import logging

from app import models, schemas
from app.database import get_db
from app.routers.auth import get_current_user, get_current_user_optional
from app.utils.moderation_dep import moderated

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feedback", tags=["Feedback"])


def get_relative_time_str(dt: datetime) -> str:
    now = datetime.now()
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    delta = now - dt
    if delta.days > 30:
        return dt.strftime("%Y-%m-%d")
    elif delta.days > 0:
        return f"{delta.days}天前"
    elif delta.seconds > 3600:
        return f"{delta.seconds // 3600}小时前"
    elif delta.seconds > 60:
        return f"{delta.seconds // 60}分钟前"
    else:
        return "刚刚"


def truncate_name(name: str) -> str:
    if len(name) > 10:
        return name[:10] + "..."
    return name


@router.get("", response_model=schemas.FeedbackListResponse)
async def list_feedbacks(
    type: Optional[str] = None,
    sort: str = "latest",
    page: int = 1,
    page_size: int = 10,
    search: Optional[str] = None,
    user_only: bool = False,
    current_user: Optional[models.User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import func, or_

    # Build query
    query = select(models.Feedback).options(
        selectinload(models.Feedback.comments)
    )

    if type and type != "全部":
        query = query.where(models.Feedback.type == type)

    if user_only and current_user:
        query = query.where(models.Feedback.user_id == current_user.id)

    if search:
        query = query.where(
            or_(
                models.Feedback.title.ilike(f"%{search}%"),
                models.Feedback.description.ilike(f"%{search}%")
            )
        )

    # Count total items matching
    count_query = select(func.count(models.Feedback.id))
    if type and type != "全部":
        count_query = count_query.where(models.Feedback.type == type)
    if user_only and current_user:
        count_query = count_query.where(models.Feedback.user_id == current_user.id)
    if search:
        count_query = count_query.where(
            or_(
                models.Feedback.title.ilike(f"%{search}%"),
                models.Feedback.description.ilike(f"%{search}%")
            )
        )

    total_res = await db.execute(count_query)
    total = total_res.scalar_one()

    # Apply sorting and pagination
    if sort == "popular":
        query = query.order_by(models.Feedback.upvotes.desc(), models.Feedback.created_at.desc())
    else:
        query = query.order_by(models.Feedback.created_at.desc())

    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    feedbacks = result.scalars().all()

    # Get user votes if logged in
    user_voted_ids = set()
    if current_user:
        votes_res = await db.execute(
            select(models.FeedbackVote.feedback_id)
            .where(models.FeedbackVote.user_id == current_user.id)
        )
        user_voted_ids = set(votes_res.scalars().all())

    items = []
    for fb in feedbacks:
        comments_list = []
        for c in fb.comments:
            comments_list.append(
                schemas.FeedbackCommentResponse(
                    id=c.id,
                    author=truncate_name(c.author_name),  # Truncate user name to 10 chars if exceeded
                    avatar=c.author_avatar or "/debugger-2.jpg",
                    content=c.content,
                    created_at=get_relative_time_str(c.created_at),
                    is_pinned=c.is_pinned
                )
            )

        items.append(
            schemas.FeedbackResponse(
                id=fb.id,
                title=fb.title,
                description=fb.description,
                author=fb.author_name,
                type=fb.type,
                module=fb.module,
                screenshot_url=fb.screenshot_url,
                upvotes=fb.upvotes,
                time=get_relative_time_str(fb.created_at),
                commentsCount=len(fb.comments),
                hasVoted=fb.id in user_voted_ids,
                comments=comments_list
            )
        )

    return schemas.FeedbackListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size
    )


@router.post("", response_model=schemas.FeedbackResponse)
async def create_feedback(
    req: schemas.FeedbackCreate,
    _moderation: None = Depends(moderated("feedback", "title", "description")),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # 内容审核由 @moderated Depends 完成(违规 raise 400 + 自动写审计);这里直接进入业务
    fb = models.Feedback(
        title=req.title,
        description=req.description,
        user_id=current_user.id,
        author_name=current_user.username,
        type=req.type,
        module=req.module,
        screenshot_url=req.screenshot_url,
        file_id=req.file_id,  # 精确外键关联 UploadedFile
        upvotes=0
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)

    return schemas.FeedbackResponse(
        id=fb.id,
        title=fb.title,
        description=fb.description,
        author=fb.author_name,
        type=fb.type,
        module=fb.module,
        screenshot_url=fb.screenshot_url,
        upvotes=0,
        time="刚刚",
        commentsCount=0,
        hasVoted=False,
        comments=[]
    )


@router.post("/{id}/vote")
async def toggle_vote(
    id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check feedback
    res = await db.execute(select(models.Feedback).where(models.Feedback.id == id))
    fb = res.scalars().first()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")

    # Check vote
    vote_res = await db.execute(
        select(models.FeedbackVote)
        .where(models.FeedbackVote.feedback_id == id)
        .where(models.FeedbackVote.user_id == current_user.id)
    )
    vote = vote_res.scalars().first()

    if vote:
        # Remove vote
        await db.delete(vote)
        fb.upvotes = max(0, fb.upvotes - 1)
        has_voted = False
    else:
        # Add vote
        new_vote = models.FeedbackVote(feedback_id=id, user_id=current_user.id)
        db.add(new_vote)
        fb.upvotes += 1
        has_voted = True

    await db.commit()
    return {"hasVoted": has_voted, "upvotes": fb.upvotes}


@router.post("/{id}/comment", response_model=schemas.FeedbackCommentResponse)
async def add_comment(
    id: int,
    req: schemas.CommentCreate,
    _moderation: None = Depends(moderated("feedback_comment", "content")),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check feedback
    res = await db.execute(select(models.Feedback).where(models.Feedback.id == id))
    fb = res.scalars().first()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")

    # 内容审核由 @moderated Depends 完成
    avatar_url = None
    if current_user.profile:
        avatar_url = current_user.profile.avatar_url

    # Truncate user name to 10 chars if exceeded (backend level safety)
    comment_author = truncate_name(current_user.username)

    is_admin = (current_user.username == "admin")
    comment = models.FeedbackComment(
        feedback_id=id,
        user_id=current_user.id,
        author_name=current_user.username,  # Store original username, but truncate when displayed
        author_avatar=avatar_url,
        content=req.content,
        is_pinned=is_admin
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    return schemas.FeedbackCommentResponse(
        id=comment.id,
        author=comment_author,
        avatar=avatar_url or "/debugger-2.jpg",
        content=comment.content,
        created_at="刚刚",
        is_pinned=comment.is_pinned
    )


from pydantic import BaseModel
class BatchDeleteRequest(BaseModel):
    ids: List[int]

@router.delete("/{id}")
async def delete_feedback(
    id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    query = select(models.Feedback).where(models.Feedback.id == id)
    res = await db.execute(query)
    fb = res.scalar_one_or_none()
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")
    
    # Check if current user is the author
    if fb.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除他人的反馈")
    
    # Delete associated screenshot from COS and database
    if fb.screenshot_url:
        from app.routers.file import delete_file_from_storage
        # fb.screenshot_url 可能是签名 URL / 非签名 cos 路径 / 纯 cos_key，统一抽 cos_key 反查
        # （UploadedFile.file_url 现在存非签名路径，screenshot_url 可能是老格式的签名 URL）
        import urllib.parse
        raw = fb.screenshot_url
        if raw.startswith("uploads/") or "/" not in raw:
            cos_key = urllib.parse.unquote(raw)
        else:
            parsed = urllib.parse.urlparse(raw)
            path = parsed.path.lstrip("/")
            cos_key = urllib.parse.unquote(path) if path else raw
        file_res = await db.execute(
            select(models.UploadedFile).where(models.UploadedFile.cos_key == cos_key)
        )
        db_file = file_res.scalars().first()
        if db_file:
            await delete_file_from_storage(db, db_file)

    # Delete associated votes, comments
    await db.execute(delete(models.FeedbackVote).where(models.FeedbackVote.feedback_id == id))
    await db.execute(delete(models.FeedbackComment).where(models.FeedbackComment.feedback_id == id))
    await db.delete(fb)
    await db.commit()
    return {"message": "删除成功"}


@router.post("/batch-delete")
async def batch_delete_feedbacks(
    req: BatchDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    if not req.ids:
        raise HTTPException(status_code=400, detail="未指定删除的反馈ID")
    
    # Fetch feedbacks matching the IDs and user_id to ensure permission
    query = select(models.Feedback).where(
        models.Feedback.id.in_(req.ids),
        models.Feedback.user_id == current_user.id
    )
    res = await db.execute(query)
    fbs = res.scalars().all()
    
    if not fbs:
        raise HTTPException(status_code=400, detail="无可删除的反馈")
    
    matched_ids = [fb.id for fb in fbs]
    
    # Delete associated screenshots from COS and database
    from app.routers.file import delete_file_from_storage
    import urllib.parse
    for fb in fbs:
        if fb.screenshot_url:
            # 兼容三种格式：签名 URL / 非签名 cos 路径 / 纯 cos_key，最后都 unquote 一次
            raw = fb.screenshot_url
            if raw.startswith("uploads/") or "/" not in raw:
                cos_key = urllib.parse.unquote(raw)
            else:
                parsed = urllib.parse.urlparse(raw)
                path = parsed.path.lstrip("/")
                cos_key = urllib.parse.unquote(path) if path else raw
            file_res = await db.execute(
                select(models.UploadedFile).where(models.UploadedFile.cos_key == cos_key)
            )
            db_file = file_res.scalars().first()
            if db_file:
                await delete_file_from_storage(db, db_file)

    # Delete associated votes, comments
    await db.execute(delete(models.FeedbackVote).where(models.FeedbackVote.feedback_id.in_(matched_ids)))
    await db.execute(delete(models.FeedbackComment).where(models.FeedbackComment.feedback_id.in_(matched_ids)))
    
    # Delete feedbacks
    for fb in fbs:
        await db.delete(fb)
    
    await db.commit()
    return {"message": f"成功删除 {len(matched_ids)} 条反馈", "deleted_ids": matched_ids}


@router.put("/comment/{comment_id}/pin")
async def toggle_comment_pin(
    comment_id: int,
    is_pinned: bool,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.username != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以置顶或取消置顶评论")

    res = await db.execute(select(models.FeedbackComment).where(models.FeedbackComment.id == comment_id))
    comment = res.scalars().first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    comment.is_pinned = is_pinned
    await db.commit()
    return {"success": True, "comment_id": comment_id, "is_pinned": comment.is_pinned}


class CommentBatchDeleteRequest(BaseModel):
    ids: List[int]


@router.delete("/comment/batch")
async def batch_delete_comments(
    req: CommentBatchDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(models.FeedbackComment).where(models.FeedbackComment.id.in_(req.ids)))
    comments = res.scalars().all()
    if len(comments) != len(req.ids):
        raise HTTPException(status_code=404, detail="部分评论未找到")

    for comment in comments:
        if comment.author_name != current_user.username and current_user.username != "admin":
            raise HTTPException(status_code=403, detail="没有权限删除部分评论")

    for comment in comments:
        await db.delete(comment)

    await db.commit()
    return {"success": True, "deleted_ids": req.ids}


@router.delete("/comment/{comment_id}")
async def delete_comment(
    comment_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(models.FeedbackComment).where(models.FeedbackComment.id == comment_id))
    comment = res.scalars().first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    if comment.author_name != current_user.username and current_user.username != "admin":
        raise HTTPException(status_code=403, detail="没有权限删除此评论")

    await db.delete(comment)
    await db.commit()
    return {"success": True, "comment_id": comment_id}
