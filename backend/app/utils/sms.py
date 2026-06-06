import logging
from app.config import settings
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.sms.v20210111 import sms_client, models

logger = logging.getLogger(__name__)

class TencentSMSHelper:
    def __init__(self):
        self.secret_id = settings.TENCENT_SECRET_ID
        self.secret_key = settings.TENCENT_SECRET_KEY
        self.sdk_app_id = settings.TENCENT_SMS_APP_ID
        self.sign_name = settings.TENCENT_SMS_SIGN_NAME
        self.template_id = settings.TENCENT_SMS_TEMPLATE_ID

    def send_verification_code(self, phone: str, code: str) -> bool:
        """
        发送验证码短信。如果腾讯云配置缺失，则进行本地模拟发送并打印至控制台。
        """
        if not all([self.secret_id, self.secret_key, self.sdk_app_id, self.sign_name, self.template_id]):
            # 腾讯云配置不完整时，本地开发进行模拟，打印到日志，避免开发者在没有资质时受阻
            logger.warning(f"[DEVELOPMENT MODE] 腾讯云配置缺失。模拟发送验证码: 手机号: {phone}, 验证码: {code}")
            print(f"\n========================================\n[SMS DEV SIMULATION] 手机验证码已发送\n手机号: {phone}\n验证码: {code}\n========================================\n")
            return True

        try:
            cred = credential.Credential(self.secret_id, self.secret_key)
            client = sms_client.SmsClient(cred, "ap-guangzhou")
            
            req = models.SendSmsRequest()
            req.SmsSdkAppId = self.sdk_app_id
            req.SignName = self.sign_name
            req.TemplateId = self.template_id
            
            # 格式化国内/国际手机号码 (E.164标准)
            formatted_phone = phone if phone.startswith("+") else f"+86{phone}"
            req.PhoneNumberSet = [formatted_phone]
            req.TemplateParamSet = [code]

            resp = client.SendSms(req)
            status_set = resp.SendStatusSet
            if not status_set:
                logger.error("腾讯云短信服务返回了空状态列表。")
                return False
                
            send_status = status_set[0]
            if send_status.Code == "Ok":
                logger.info(f"短信成功发送至 {phone}，RequestId: {resp.RequestId}")
                return True
            else:
                logger.error(f"短信发送失败: {send_status.Code} - {send_status.Message}")
                return False

        except TencentCloudSDKException as err:
            logger.exception("调用腾讯云短信 SDK 抛出异常")
            return False

sms_helper = TencentSMSHelper()
