import logging
from app.config import settings
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.sms.v20210111 import sms_client, models
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile

logger = logging.getLogger(__name__)

class TencentSMSHelper:
    def __init__(self):
        pass

    def send_verification_code(self, phone: str, code: str) -> bool:
        """
        根据腾讯云 SMS SDK 3.0 发送验证码短信。
        若秘钥或参数未配置，自动启用开发模式模拟发送（仅打日志标记，不打印手机号/验证码）。
        """
        secret_id = settings.TENCENT_SECRET_ID
        secret_key = settings.TENCENT_SECRET_KEY
        sdk_app_id = settings.TENCENT_SMS_APP_ID
        sign_name = settings.TENCENT_SMS_SIGN_NAME
        template_id = settings.TENCENT_SMS_TEMPLATE_ID
        region = settings.TENCENT_SMS_REGION or "ap-guangzhou"

        if not all([secret_id, secret_key, sdk_app_id, sign_name, template_id]):
            logger.warning(
                "[SMS DEV SIMULATION] 腾讯云凭据未在 .env 配置完全，"
                "已模拟发送验证码（手机号/验证码不写入日志）。"
            )
            return True

        try:
            # 1. 实例化认证对象
            cred = credential.Credential(secret_id, secret_key)
            
            # 2. 配置 HTTP 属性
            httpProfile = HttpProfile()
            httpProfile.reqMethod = "POST"
            httpProfile.reqTimeout = 10
            httpProfile.endpoint = "sms.tencentcloudapi.com"

            # 3. 配置 Client 属性
            clientProfile = ClientProfile()
            clientProfile.signMethod = "TC3-HMAC-SHA256"
            clientProfile.httpProfile = httpProfile

            # 4. 实例化 SmsClient
            client = sms_client.SmsClient(cred, region, clientProfile)

            # 5. 组装 SendSmsRequest 请求
            req = models.SendSmsRequest()
            req.SmsSdkAppId = str(sdk_app_id)
            req.SignName = str(sign_name)
            req.TemplateId = str(template_id)
            
            # E.164 格式手机号（标准格式 +86138xxxxxxxx）
            clean_phone = phone.strip()
            formatted_phone = clean_phone if clean_phone.startswith("+") else f"+86{clean_phone}"
            req.PhoneNumberSet = [formatted_phone]
            
            # 模板变量设置（对应模板中的 {1} 验证码 和 {2} 有效期 5 分钟）
            req.TemplateParamSet = [str(code), "5"]

            # 6. 发起 API 调用
            resp = client.SendSms(req)
            status_set = resp.SendStatusSet
            if not status_set:
                logger.error("腾讯云短信服务返回了空 SendStatusSet 列表。")
                return False

            send_status = status_set[0]
            if send_status.Code == "Ok":
                logger.info(f"[SMS SUCCESS] 验证码短信已投递（RequestId: {resp.RequestId}, SerialNo: {send_status.SerialNo}）")
                return True
            else:
                logger.error(f"[SMS ERROR] 发送失败 Code={send_status.Code}, Message={send_status.Message}, RequestId: {resp.RequestId}")
                return False

        except TencentCloudSDKException as err:
            logger.exception(f"调用腾讯云 SMS SDK 抛出异常: {err}")
            return False
        except Exception as e:
            logger.exception(f"发送短信未知异常: {e}")
            return False

sms_helper = TencentSMSHelper()
