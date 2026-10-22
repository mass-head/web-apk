import { Router } from 'express';
import conversionsRoutes from './conversions.routes.js';
import healthRoutes from './health.routes.js';
import validateRoutes from './validate.routes.js';

const apiRouter = Router();

apiRouter.use('/conversions', conversionsRoutes);
apiRouter.use('/builds', conversionsRoutes);
apiRouter.use('/validate', validateRoutes);
apiRouter.use('/', healthRoutes);

export default apiRouter;
