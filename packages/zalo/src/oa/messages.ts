import {
	OA_FORM_SUBTITLE_MAX_LENGTH,
	OA_FORM_TITLE_MAX_LENGTH,
	OA_MENU_MAX_BUTTONS,
	OA_MESSAGE_TEXT_MAX_LENGTH,
	OaConfigError,
	oaTextValid,
	type ZaloButton,
} from "./menu.js";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_URL_PATTERN = /^https:\/\/[^\s]{1,500}$/;

export interface ConsultationMessage {
	readonly recipient: { readonly user_id: string };
	readonly message: Readonly<Record<string, unknown>>;
}

export interface UserInfoForm {
	readonly title: string;
	readonly subtitle: string;
	readonly imageUrl: string;
}

function recipientOf(userId: string): { readonly user_id: string } {
	if (!USER_ID_PATTERN.test(userId)) {
		throw new OaConfigError("the OA user id is malformed");
	}
	return { user_id: userId };
}

export function textMessage(
	userId: string,
	text: string,
	buttons: readonly ZaloButton[],
): ConsultationMessage {
	if (!oaTextValid(text, OA_MESSAGE_TEXT_MAX_LENGTH)) {
		throw new OaConfigError(
			`a consultation text is 1 to ${OA_MESSAGE_TEXT_MAX_LENGTH} characters without a link or a phone number`,
		);
	}
	if (buttons.length > OA_MENU_MAX_BUTTONS) {
		throw new OaConfigError(
			`a consultation message carries at most ${OA_MENU_MAX_BUTTONS} buttons`,
		);
	}
	return {
		recipient: recipientOf(userId),
		message:
			buttons.length === 0
				? { text }
				: {
						text,
						attachment: {
							type: "template",
							payload: { buttons: [...buttons] },
						},
					},
	};
}

export function userInfoRequest(
	userId: string,
	form: UserInfoForm,
): ConsultationMessage {
	if (
		!oaTextValid(form.title, OA_FORM_TITLE_MAX_LENGTH) ||
		!oaTextValid(form.subtitle, OA_FORM_SUBTITLE_MAX_LENGTH)
	) {
		throw new OaConfigError(
			`the form title is 1 to ${OA_FORM_TITLE_MAX_LENGTH} and its subtitle 1 to ${OA_FORM_SUBTITLE_MAX_LENGTH} characters`,
		);
	}
	if (!IMAGE_URL_PATTERN.test(form.imageUrl)) {
		throw new OaConfigError("the form image is an https address");
	}
	return {
		recipient: recipientOf(userId),
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "request_user_info",
					elements: [
						{
							title: form.title,
							subtitle: form.subtitle,
							image_url: form.imageUrl,
						},
					],
				},
			},
		},
	};
}
