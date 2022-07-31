import dayjs from './services/dayjs';

const log = (...msg: any) => {
  console.log(dayjs().format('HH:mm:ss'), '>', ...msg);
};

export default log;
