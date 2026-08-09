import { Request, Response } from 'express';

export default async (req: Request, res: Response) => {
  try {
    const event = req.body.event;
    if (!event || event.op !== 'INSERT') {
      return res.status(200).json({ success: true, message: 'Skipped non-insert event' });
    }

    const newRow = event.data.new;
    const { id, run_id, step_id, recipient, message } = newRow;

    console.log(`[Notification Alert] ID: ${id}, Run: ${run_id}, Step: ${step_id}`);
    console.log(`To: ${recipient}`);
    console.log(`Message: ${message}`);

    return res.status(200).json({
      success: true,
      delivered_to: recipient,
      message_id: id
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
